import type { PriceTrackingData, PriceWatch } from '../../shared/types'
import { readOfflineTracking, saveOfflineTracking, withOfflineLock } from '../utils/offline-storage'
const loads=new Map<string,Promise<void>>()
export function usePriceTracking() {
  const {user,demo,api}=useAccount()
  const data=useState<PriceTrackingData>('price-tracking-data',()=>({watches:[],alerts:[],unread_count:0}))
  const owner=useState('price-tracking-owner',()=> '')
  const loaded=useState('price-tracking-loaded',()=>false)
  const error=useState('price-tracking-error',()=> '')
  const cached=useState('price-tracking-cached',()=>false)
  const revision=useState('price-tracking-revision',()=>0)
  const unread=computed(()=>data.value.unread_count)
  function reset(account='') {owner.value=account;data.value={watches:[],alerts:[],unread_count:0};loaded.value=false;error.value='';cached.value=false;revision.value++}
  async function persist(account:string) {
    if(demo) {localStorage.setItem('osk-demo-tracking-v1',JSON.stringify(data.value));return}
    await withOfflineLock(account,async()=>{
      if(user.value?.id===account && owner.value===account) await saveOfflineTracking(account,data.value)
    }).catch(()=>{/* Optional tracking cache must not fail an already saved server change. */})
  }
  async function load() {
    const account=demo?'demo':user.value?.id
    if(!account) {reset();return}
    if(owner.value!==account) reset(account)
    if(loads.has(account)) return loads.get(account)
    const started=revision.value
    const task=(async()=>{
      if(demo) {
        if(!loaded.value) try {const saved=localStorage.getItem('osk-demo-tracking-v1');if(saved)data.value=JSON.parse(saved)}catch{/* Start with empty sample targets. */}
        loaded.value=true;return
      }
      if(!loaded.value) {
        const saved=await readOfflineTracking(account).catch(()=>undefined)
        if(user.value?.id!==account || owner.value!==account || revision.value!==started) return
        if(saved) {data.value=saved;loaded.value=true;cached.value=true}
      }
      if(!navigator.onLine) {cached.value=true;return}
      try {
        const result=await api<PriceTrackingData>('/api/tracking',{accountId:account,timeout:10000})
        if(user.value?.id!==account || owner.value!==account || revision.value!==started) return
        data.value=result;loaded.value=true;cached.value=false;error.value='';await persist(account)
      } catch(e:any) {
        if(user.value?.id===account && owner.value===account) {cached.value=true;error.value=e.data?.statusMessage||'Targets and alerts could not refresh. Reconnect and retry.'}
      }
    })()
    loads.set(account,task)
    try {await task} finally {if(loads.get(account)===task)loads.delete(account)}
  }
  function accountForWrite() {
    const account=demo?'demo':user.value?.id
    if(!account || account!==owner.value) throw new Error('Sign in before changing price targets.')
    if(!demo && !navigator.onLine) throw new Error('Reconnect to change targets or mark alerts as read. Your offline additions are kept.')
    return account
  }
  async function setTarget(itemId:string,target_cents:number) {
    const account=accountForWrite()
    if(!Number.isSafeInteger(target_cents)||target_cents<1||target_cents>100000000)throw new Error('Enter a target between $0.01 and $1,000,000.')
    const now=new Date().toISOString(),old=data.value.watches.find(w=>w.item_id===itemId)
    const watch:PriceWatch=demo?{id:old?.id||crypto.randomUUID(),user_id:account,item_id:itemId,target_cents,is_met:false,last_price_cents:null,last_checked_at:null,created_at:old?.created_at||now,updated_at:now}
      :await api(`/api/items/${itemId}/target`,{method:'POST',body:{target_cents},accountId:account})
    if(owner.value!==account || (!demo && user.value?.id!==account))return
    revision.value++;data.value={...data.value,watches:[...data.value.watches.filter(w=>w.item_id!==itemId),watch]};await persist(account)
  }
  async function removeTarget(itemId:string) {
    const account=accountForWrite()
    if(!demo)await api(`/api/items/${itemId}/target`,{method:'DELETE',accountId:account})
    if(owner.value!==account || (!demo && user.value?.id!==account))return
    const removed=new Set(data.value.watches.filter(w=>w.item_id===itemId).map(w=>w.id))
    const alerts=data.value.alerts.filter(a=>!removed.has(a.watch_id))
    revision.value++;data.value={watches:data.value.watches.filter(w=>w.item_id!==itemId),alerts,unread_count:Math.max(0,data.value.unread_count-data.value.alerts.filter(a=>removed.has(a.watch_id)&&!a.read_at).length)}
    await persist(account);if(!demo) await load()
  }
  async function markRead(id?:string) {
    const account=accountForWrite()
    if(!demo)await api('/api/price-alerts/read',{method:'PATCH',body:id?{id}:{},accountId:account})
    if(owner.value!==account || (!demo && user.value?.id!==account))return
    const count=data.value.alerts.filter(a=>(!id||a.id===id)&&!a.read_at).length
    revision.value++;data.value={...data.value,alerts:data.value.alerts.map(a=>(!id||a.id===id)?{...a,read_at:a.read_at||new Date().toISOString()}:a),unread_count:id?Math.max(0,data.value.unread_count-count):0}
    await persist(account)
  }
  return {data,loaded,error,cached,owner,unread,reset,load,setTarget,removeTarget,markRead}
}
