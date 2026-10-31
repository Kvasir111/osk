import type { ProductDraft, WishItem, WishList, PriceCheckDetails } from '../../shared/types'
import { normalizePicture } from '../../shared/product-images'
import { demoData } from '../utils/demo'
import { readOfflineAccount, saveOfflineSnapshot, putAddition, removeAddition, withOfflineLock, type PendingAddition, type OfflineSnapshot } from '../utils/offline-storage'
import { overlayAdditions, syncProblem } from '../../shared/offline'
const runningSyncs = new Map<string, Promise<void>>()

export function useWishlists() {
  const { api, demo, user } = useAccount()
  const lists = useState<WishList[]>('wish-lists', () => [])
  const items = useState<WishItem[]>('wish-items', () => [])
  const roles = useState<Record<string, string>>('wish-roles', () => ({}))
  const activeId = useState<string>('active-list', () => '')
  const loaded = useState('wish-loaded', () => false)
  const revision = useState('offline-revision', () => 0)
  const online = useState('offline-online', () => import.meta.client ? navigator.onLine : true)
  const syncing = useState('offline-syncing', () => false)
  const pending = useState<PendingAddition[]>('offline-pending', () => [])
  const syncError = useState('offline-error', () => '')
  const storageError = useState('offline-storage-error', () => '')
  const cachedOwner = useState('offline-owner', () => '')
  const lastSavedAt = useState<string | null>('offline-last-saved', () => null)
  const active = computed(() => lists.value.find(l => l.id === activeId.value))
  const activeItems = computed(() => items.value.filter(i => i.list_id === activeId.value))
  const isOwner = computed(() => demo || active.value?.owner_id === user.value?.id)
  const canEdit = computed(() => isOwner.value || roles.value[activeId.value] === 'editor')
  function persist() {
    revision.value++
    if (demo) localStorage.setItem('osk-demo-v1', JSON.stringify({ lists: lists.value, items: items.value }))
    else void cacheSnapshot().catch(() => { storageError.value = 'Offline storage is unavailable. Keep this app open until your additions sync.' })
  }
  function snapshot(): OfflineSnapshot {
    const account = user.value!
    return { accountId: account.id, identity: { id: account.id, email: account.email, user_metadata: { display_name: account.user_metadata?.display_name } }, lists: lists.value, items: items.value, roles: roles.value, savedAt: new Date().toISOString() }
  }
  async function cacheSnapshot() {
    const account = user.value?.id
    if (!account || cachedOwner.value !== account) return
    await withOfflineLock(account, async () => {
      if (user.value?.id === account && cachedOwner.value === account) await saveOfflineSnapshot(snapshot())
    })
  }
  async function restore() {
    const account = user.value?.id
    if (demo || !account) return
    if (cachedOwner.value !== account) {
      lists.value = []; items.value = []; roles.value = {}; pending.value = []; activeId.value = ''; loaded.value = false
      cachedOwner.value = account; syncError.value = ''; storageError.value = ''; lastSavedAt.value = null
    }
    try {
      const cached = await readOfflineAccount(account)
      if (user.value?.id !== account) return
      pending.value = cached.additions
      if (!loaded.value && cached.snapshot) {
        lists.value = cached.snapshot.lists; items.value = cached.snapshot.items; roles.value = cached.snapshot.roles
        lastSavedAt.value = cached.snapshot.savedAt
      }
      const merged = overlayAdditions(lists.value, items.value, pending.value)
      lists.value = merged.lists; items.value = merged.items
      if (cached.snapshot || pending.value.length) loaded.value = true
      if (!lists.value.some(l => l.id === activeId.value)) activeId.value = lists.value[0]?.id || ''
    } catch { storageError.value = 'Device storage is unavailable. Allow storage to use Ósk offline.' }
  }
  async function load() {
    if (demo) {
      try {
        const saved = localStorage.getItem('osk-demo-v1') || localStorage.getItem('wishwell-demo-v1')
        const data = saved ? JSON.parse(saved) : demoData()
        lists.value = data.lists; items.value = data.items; persist()
      } catch { const data = demoData(); lists.value = data.lists; items.value = data.items }
    } else {
      const account = user.value?.id
      if (!account) return
      await restore()
      if (!navigator.onLine) {
        online.value = false
        if (!loaded.value) throw new Error('Connect once to save your lists for offline use.')
        return
      }
      try {
        const startedAtRevision = revision.value
        const data = await api<{ lists: WishList[]; memberships: { list_id: string; role: string }[] }>('/api/lists', { accountId: account })
        const records = (await Promise.all(data.lists.map(l => api<WishItem[]>(`/api/lists/${l.id}/items`, { accountId: account })))).flat()
        const additions = (await readOfflineAccount(account)).additions
        if (user.value?.id !== account || revision.value !== startedAtRevision) return
        pending.value = additions
        const merged = overlayAdditions(data.lists, records, additions)
        lists.value = merged.lists; items.value = merged.items
        roles.value = Object.fromEntries(data.memberships.map(m => [m.list_id, m.role]))
        online.value = true; lastSavedAt.value = new Date().toISOString(); loaded.value = true
        await cacheSnapshot().catch(() => { storageError.value = 'Your lists could not be saved for offline use. Check device storage.' })
      } catch (error: any) {
        const status = Number(error.status || error.statusCode || error.response?.status || 0)
        if (!status || status >= 500) { online.value = false; if (loaded.value) return }
        if (status === 401) syncError.value = syncProblem(401)
        throw error
      }
    }
    if (!lists.value.some(l => l.id === activeId.value)) activeId.value = lists.value[0]?.id || ''
    loaded.value = true
  }
  async function enqueue(addition: PendingAddition) {
    const account = user.value?.id
    if (!account || account !== addition.accountId) throw new Error('Sign in before adding a wish.')
    await withOfflineLock(account, async () => {
      if (user.value?.id !== account) throw new Error('Your account changed. Please try again.')
      await putAddition(addition)
      revision.value++
      pending.value = (await readOfflineAccount(account)).additions
      const merged = overlayAdditions(lists.value, items.value, pending.value)
      lists.value = merged.lists; items.value = merged.items
      await saveOfflineSnapshot(snapshot()).catch(() => { storageError.value = 'Your addition is queued, but the list cache could not be updated.' })
    })
  }
  async function sync(retry = false) {
    const account = user.value?.id
    if (demo || !account || !navigator.onLine) return
    if (runningSyncs.has(account)) return runningSyncs.get(account)
    const task = withOfflineLock(account, async () => {
      if (user.value?.id !== account) return
      syncing.value = true; syncError.value = ''; online.value = true
      try {
        const additions = (await readOfflineAccount(account)).additions.sort((a, b) => (a.kind === 'list' ? 0 : 1) - (b.kind === 'list' ? 0 : 1) || a.createdAt.localeCompare(b.createdAt))
        for (const addition of additions) {
          if (user.value?.id !== account || !navigator.onLine) break
          if (addition.status === 'blocked' && !retry) continue
          try {
            if (addition.kind === 'item') {
              const remaining = (await readOfflineAccount(account)).additions
              if (remaining.some(op => op.kind === 'list' && op.id === addition.listId)) {
                await putAddition({ ...addition, status: 'blocked', error: 'Sync its new list first, then retry this wish.' }); continue
              }
            }
            const result = addition.kind === 'list'
              ? await api<WishList>('/api/lists', { method: 'POST', body: { ...addition.product, client_id: addition.id }, accountId: account })
              : await api<WishItem>(`/api/lists/${addition.listId}/items`, { method: 'POST', body: { product: addition.product, client_id: addition.id }, accountId: account })
            if (user.value?.id !== account) return
            await removeAddition(addition.id)
            revision.value++
            if (addition.kind === 'list') lists.value = lists.value.map(l => l.id === addition.id ? result as WishList : l)
            else {
              items.value = items.value.map(i => i.id === addition.id ? result as WishItem : i)
              awaitPicture(result as WishItem)
            }
          } catch (error: any) {
            const status = Number(error.status || error.statusCode || error.response?.status || 0)
            if (user.value?.id !== account) return
            if (!status || status >= 500 || status === 429) {
              syncError.value = 'Sync paused. Your additions are safe on this device; we’ll try again.'
              if (!status) online.value = false
              break
            }
            if (status === 401) { syncError.value = syncProblem(401); break }
            await putAddition({ ...addition, status: 'blocked', error: syncProblem(status) })
          }
        }
        if (user.value?.id === account) {
          pending.value = (await readOfflineAccount(account)).additions
          await saveOfflineSnapshot(snapshot())
        }
      } catch { if (user.value?.id === account) storageError.value = 'Device storage could not be read. Your unsynced additions have been kept.' }
      finally { if (user.value?.id === account) syncing.value = false }
    })
    runningSyncs.set(account, task)
    try { await task } finally { runningSyncs.delete(account) }
  }
  async function discardAddition(id: string) {
    const account = user.value?.id
    if (!account) return
    await withOfflineLock(account, async () => {
      if (user.value?.id !== account) return
      const additions = (await readOfflineAccount(account)).additions
      const target = additions.find(op => op.id === id)
      if (!target) throw new Error('This addition has already synced. Refresh your lists before removing it.')
      const removed = additions.filter(op => op.id === id || (target.kind === 'list' && op.kind === 'item' && op.listId === id))
      for (const addition of removed) await removeAddition(addition.id)
      revision.value++
      const ids = new Set(removed.map(op => op.id))
      pending.value = additions.filter(op => !ids.has(op.id))
      lists.value = lists.value.filter(l => !ids.has(l.id)); items.value = items.value.filter(i => !ids.has(i.id))
      if (!lists.value.some(l => l.id === activeId.value)) activeId.value = lists.value[0]?.id || ''
      await saveOfflineSnapshot(snapshot())
    })
  }
  async function createList(input: Pick<WishList, 'name' | 'description' | 'occasion'>) {
    if (!demo) {
      if (!user.value) throw new Error('Sign in before creating a list.')
      const id = crypto.randomUUID()
      await enqueue({ id, accountId: user.value.id, kind: 'list', product: input, createdAt: new Date().toISOString(), status: 'pending' })
      activeId.value = id; await sync(); return
    }
    const list: WishList = demo ? { ...input, id: crypto.randomUUID(), owner_id: 'demo', created_at: new Date().toISOString(), share_token: null }
      : await api('/api/lists', { method: 'POST', body: input })
    lists.value.push(list); activeId.value = list.id; persist()
  }
  async function updateList(input: Pick<WishList, 'name' | 'description' | 'occasion'>) {
    if (!active.value) return
    if (!demo && (!navigator.onLine || active.value.pending_sync)) throw new Error('Sync this list and reconnect before editing its details.')
    const list = demo ? { ...active.value, ...input } : await api<WishList>(`/api/lists/${activeId.value}`, { method: 'PATCH', body: input })
    lists.value = lists.value.map(l => l.id === list.id ? list : l); persist()
  }
  async function deleteList() {
    const id = activeId.value
    if (!demo && pending.value.some(op => op.id === id)) return discardAddition(id)
    if (!demo && !navigator.onLine) throw new Error('Removing a saved list needs a connection.')
    if (!demo) await api(`/api/lists/${id}`, { method: 'DELETE' })
    lists.value = lists.value.filter(l => l.id !== id); items.value = items.value.filter(i => i.list_id !== id)
    activeId.value = lists.value[0]?.id || ''; persist()
  }
  function awaitPicture(item:WishItem) {
    if(demo||(item.image_mode||'auto')!=='auto'||item.image_url)return
    const account=user.value?.id
    for(const delay of [2000,6500])setTimeout(async()=>{
      const current=items.value.find(i=>i.id===item.id)
      if(user.value?.id!==account||!current||current.image_url||(current.image_mode||'auto')!=='auto'||current.name!==item.name||current.variant!==item.variant)return
      try{
        const records=await api<WishItem[]>(`/api/lists/${item.list_id}/items`)
        const pictured=records.find(i=>i.id===item.id)
        if(pictured?.image_url&&user.value?.id===account)items.value=items.value.map(i=>i.id===item.id&&(i.image_mode||'auto')==='auto'&&!i.image_url&&i.name===item.name&&i.variant===item.variant?{...i,image_url:pictured.image_url,image_source_url:pictured.image_source_url}:i)
      }catch{/* Optional picture hydration can wait until the next normal load. */}
    },delay)
  }
  async function saveItem(product: ProductDraft, checked_at: string | null = null, itemId?: string, price_check_details?: PriceCheckDetails, search_id?: string, targetListId = activeId.value) {
    if (!lists.value.some(l => l.id === targetListId)) throw new Error('Create a list first.')
    product=normalizePicture(product)
    if (!demo && !itemId && !search_id) {
      if (!user.value) throw new Error('Sign in before adding a wish.')
      const target = lists.value.find(l => l.id === targetListId)!
      if (target.owner_id !== user.value.id && roles.value[targetListId] !== 'editor') throw new Error('Choose a list you can edit.')
      await enqueue({ id: crypto.randomUUID(), accountId: user.value.id, kind: 'item', listId: targetListId, product, createdAt: new Date().toISOString(), status: 'pending' })
      await sync(); return
    }
    if (!demo && (!navigator.onLine || (itemId && pending.value.some(op => op.id === itemId)))) throw new Error('Sync and reconnect before editing saved wishes or approving research.')
    if (itemId) {
      const existing = items.value.find(i => i.id === itemId)!
      const item = demo ? { ...existing, ...product, checked_at: null, last_attempt_at: null, price_check_details: undefined, refresh_status: 'never' as const } : await api<WishItem>(`/api/items/${itemId}`, { method: 'PATCH', body: product })
      items.value = items.value.map(i => i.id === itemId ? item : i); awaitPicture(item)
    } else {
      const item: WishItem = demo ? { ...product, id: crypto.randomUUID(), list_id: targetListId,
        created_at: new Date().toISOString(), checked_at, last_attempt_at: checked_at, refresh_status: checked_at ? 'ok' : 'never' }
        : await api(`/api/lists/${targetListId}/items`, { method: 'POST', body: { product, checked_at, price_check_details, search_id } })
      items.value.unshift(item); awaitPicture(item)
    }
    persist()
  }
  async function deleteItem(id: string) {
    if (!demo && pending.value.some(op => op.id === id)) return discardAddition(id)
    if (!demo && !navigator.onLine) throw new Error('Removing a saved wish needs a connection.')
    if (!demo) await api(`/api/items/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(i => i.id !== id); persist()
  }
  return { online, syncing, pending, syncError, storageError, lastSavedAt, restore, sync, discardAddition, lists, items, activeId, active, activeItems, loaded, roles, isOwner, canEdit, load, createList, updateList, deleteList, saveItem, deleteItem }
}
