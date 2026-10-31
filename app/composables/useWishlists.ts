import type { ProductDraft, WishItem, WishList, PriceCheckDetails } from '../../shared/types'
import { normalizePicture } from '../../shared/product-images'
import { demoData } from '../utils/demo'

export function useWishlists() {
  const { api, demo, user } = useAccount()
  const lists = useState<WishList[]>('wish-lists', () => [])
  const items = useState<WishItem[]>('wish-items', () => [])
  const roles = useState<Record<string, string>>('wish-roles', () => ({}))
  const activeId = useState<string>('active-list', () => '')
  const loaded = useState('wish-loaded', () => false)
  const active = computed(() => lists.value.find(l => l.id === activeId.value))
  const activeItems = computed(() => items.value.filter(i => i.list_id === activeId.value))
  const isOwner = computed(() => demo || active.value?.owner_id === user.value?.id)
  const canEdit = computed(() => isOwner.value || roles.value[activeId.value] === 'editor')
  function persist() {
    if (demo) localStorage.setItem('osk-demo-v1', JSON.stringify({ lists: lists.value, items: items.value }))
  }
  async function load() {
    if (demo) {
      try {
        // Keep existing local lists available after the Ósk rename.
        const saved = localStorage.getItem('osk-demo-v1') || localStorage.getItem('wishwell-demo-v1')
        const data = saved ? JSON.parse(saved) : demoData()
        lists.value = data.lists
        items.value = data.items
        persist()
      } catch { const data = demoData(); lists.value = data.lists; items.value = data.items }
    } else {
      const data = await api<{ lists: WishList[]; memberships: { list_id: string; role: string }[] }>('/api/lists')
      lists.value = data.lists
      roles.value = Object.fromEntries(data.memberships.map(m => [m.list_id, m.role]))
      // Load all visible lists for accurate overview counts.
      items.value = (await Promise.all(data.lists.map(l => api<WishItem[]>(`/api/lists/${l.id}/items`)))).flat()
    }
    if (!lists.value.some(l => l.id === activeId.value)) activeId.value = lists.value[0]?.id || ''
    loaded.value = true
  }
  async function createList(input: Pick<WishList, 'name' | 'description' | 'occasion'>) {
    const list: WishList = demo ? { ...input, id: crypto.randomUUID(), owner_id: 'demo', created_at: new Date().toISOString(), share_token: null }
      : await api('/api/lists', { method: 'POST', body: input })
    lists.value.push(list); activeId.value = list.id; persist()
  }
  async function updateList(input: Pick<WishList, 'name' | 'description' | 'occasion'>) {
    if (!active.value) return
    const list = demo ? { ...active.value, ...input } : await api<WishList>(`/api/lists/${activeId.value}`, { method: 'PATCH', body: input })
    lists.value = lists.value.map(l => l.id === list.id ? list : l); persist()
  }
  async function deleteList() {
    const id = activeId.value
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
    if (!demo) await api(`/api/items/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(i => i.id !== id); persist()
  }
  return { lists, items, activeId, active, activeItems, loaded, roles, isOwner, canEdit, load, createList, updateList, deleteList, saveItem, deleteItem }
}
