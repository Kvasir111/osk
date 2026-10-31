export default defineNuxtPlugin({ name: 'pwa', dependsOn: ['supabase'], async setup(nuxtApp) {
  const { user, client, demo } = useAccount()
  const publicConfig = useRuntimeConfig().public
  const store = useWishlists()
  const ready = useState('pwa-ready', () => false)
  let refreshing = false
  async function reconnect() {
    store.online.value = navigator.onLine
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
  const timer = setInterval(() => { if (store.pending.value.some(op => op.status === 'pending')) void reconnect() }, 30_000)
  nuxtApp.vueApp.onUnmount(() => clearInterval(timer))
  nuxtApp.hook('app:mounted', () => { void reconnect() })
  if (!import.meta.dev && 'serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      void navigator.serviceWorker.ready.then(() => { ready.value = true })
    } catch { /* Network-only use still works if the worker cannot install. */ }
  }
} })
