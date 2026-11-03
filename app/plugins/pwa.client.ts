export default defineNuxtPlugin({ name: 'pwa', dependsOn: ['supabase'], async setup(nuxtApp) {
  const { user, client, demo } = useAccount()
  const publicConfig = useRuntimeConfig().public
  const store = useWishlists()
  const ready = useState('pwa-ready', () => false)
  const updateAvailable = useState('pwa-update-available', () => false)
  const updating = useState('pwa-updating', () => false)
  const updateError = useState('pwa-update-error', () => '')
  let registration: ServiceWorkerRegistration | undefined
  let controller = import.meta.client && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null
  let lastUpdateCheck = 0
  let reloadRequested = false
  let updateTimeout: ReturnType<typeof setTimeout> | undefined
  async function checkUpdate() {
    if (!registration || !navigator.onLine || document.hidden || Date.now() - lastUpdateCheck < 60_000) return
    lastUpdateCheck = Date.now()
    try { await registration.update() } catch { /* Keep the current offline shell on network failure. */ }
  }
  function applyUpdate() {
    if (!updateAvailable.value || updating.value || store.syncing.value) return
    updateError.value = ''
    const waiting = registration?.waiting
    if (!waiting) { location.reload(); return }
    updating.value = true; reloadRequested = true
    updateTimeout = setTimeout(() => {
      reloadRequested = false; updating.value = false
      updateError.value = 'The update could not finish. Try again when you’re online.'
    }, 15_000)
    waiting.postMessage({ type: 'OSK_ACTIVATE_UPDATE' })
  }
  let refreshing = false
  async function reconnect() {
    store.online.value = navigator.onLine
    void checkUpdate()
    if (refreshing || !navigator.onLine || !user.value || demo) return
    refreshing = true
    try {
      if (client) {
        const account = user.value?.id
        client.auth.startAutoRefresh()
        const { data } = await client.auth.getSession()
        if (user.value?.id !== account) return
        if (!data.session) { user.value = null; return }
        if (data.session.user.id !== account) { user.value = data.session.user; return }
      }
      await store.sync()
      await store.load()
    } catch { /* Cached data and queued additions stay available; status shows failures. */ }
    finally { refreshing = false }
  }
  await store.restore()
  watch(() => user.value?.id, async () => {
    store.lists.value = []; store.items.value = []; store.roles.value = {}; store.pending.value = []
    store.loaded.value = false; store.activeId.value = ''; store.syncing.value = false
    store.syncError.value = ''; store.storageError.value = ''; store.lastSavedAt.value = null
    await store.restore()
    await reconnect()
  })
  window.addEventListener('storage', event => {
    const url = publicConfig.supabaseUrl
    if (url && event.key === `sb-${new URL(url).hostname.split('.')[0]}-auth-token` && event.newValue === null) user.value = null
  })
  window.addEventListener('online', reconnect)
  window.addEventListener('offline', () => { store.online.value = false; client?.auth.stopAutoRefresh() })
  window.addEventListener('focus', reconnect)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void reconnect() })
  const timer = setInterval(() => { if (store.pending.value.some(op => op.status === 'pending')) void reconnect(); if (Date.now() - lastUpdateCheck >= 5 * 60_000) void checkUpdate() }, 30_000)
  nuxtApp.vueApp.onUnmount(() => { clearInterval(timer); clearTimeout(updateTimeout) })
  nuxtApp.hook('app:mounted', () => { void reconnect() })
  if (!import.meta.dev && 'serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const next = navigator.serviceWorker.controller
        if (controller && next !== controller) {
          updateAvailable.value = true
          if (reloadRequested) { clearTimeout(updateTimeout); location.reload(); return }
        }
        controller = next
      })
      registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      function watchInstallation() {
        const installing = registration?.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) updateAvailable.value = true
        })
      }
      if (registration.waiting && navigator.serviceWorker.controller) updateAvailable.value = true
      registration.addEventListener('updatefound', watchInstallation)
      watchInstallation()
      void checkUpdate()
      void navigator.serviceWorker.ready.then(() => { ready.value = true })
    } catch { /* Network-only use still works if the worker cannot install. */ }
  }
  return { provide: { pwaUpdates: { check: checkUpdate, apply: applyUpdate } } }
} })
