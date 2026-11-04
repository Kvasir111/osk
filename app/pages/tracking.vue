<script setup lang="ts">
import type { ProductDraft, WishItem } from '../../shared/types'
import {trackingHealth,healthLabels,trackingReason,type TrackingHealth} from '../../shared/tracking-health'
import {bestOffer,money} from '../../shared/pricing'
const {user,demo,api}=useAccount()
const store=useWishlists()
const tracking=usePriceTracking()
const route=useRoute()
const tab=ref(route.query.tab==='alerts'?'alerts':'health')
watch(()=>route.query.tab,value=>{if(value==='alerts')tab.value='alerts'})
const loading=ref(true),error=ref(''),busy=ref(false),message=ref('')
const query=ref(''),listId=ref(''),health=ref('all')
const selectedIds=ref<string[]>([])
const selected=ref<WishItem>()
const modal=ref<'detail'|'edit'|'repair'|null>(null)
const now=ref(Date.now())
let clock:ReturnType<typeof setInterval>|undefined
const metrics=computed(()=>Object.fromEntries(Object.keys(healthLabels).map(key=>[key,store.items.value.filter(i=>trackingHealth(i,now.value)===key).length])) as Record<TrackingHealth,number>)
const visible=computed(()=>store.items.value.filter(i=>(!listId.value || i.list_id===listId.value) && (health.value==='all' || trackingHealth(i,now.value)===health.value)
  && `${i.name} ${i.variant} ${trackingReason(i)}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const alertItems=computed(()=>tracking.data.value.alerts.filter(a=>store.items.value.some(i=>i.id===a.item_id && (!i.status||i.status==='active') && i.name===a.name && i.variant===a.variant)))
const results=ref<Record<string,{state:'queued'|'running'|'ok'|'failed'|'skipped'|'background'|'error';message:string}>>({})
const running=computed(()=>Object.values(results.value).some(r=>r.state==='running'||r.state==='queued'))
const progress=computed(()=>{const values=Object.values(results.value);return {total:values.length,done:values.filter(r=>!['running','queued'].includes(r.state)).length}})
let generation=0
watch(()=>user.value?.id,()=>{generation++;selected.value=undefined;modal.value=null;selectedIds.value=[];results.value={};if(!demo && !user.value)navigateTo('/login')})
watch([query,listId,health],()=>{selectedIds.value=[]})
useHead({title:'Tracking & alerts · Ósk',meta:[{name:'robots',content:'noindex, nofollow'}]})
onMounted(async()=>{
  if(!demo && !user.value){await navigateTo('/login?next=/tracking');return}
  try{await store.load();await tracking.load()}catch(e:any){error.value=e.data?.statusMessage||e.message||'Your saved wishes could not load.'}
  finally{loading.value=false}
  clock=setInterval(()=>{now.value=Date.now()},60000)
})
onBeforeUnmount(()=>{generation++;clearInterval(clock)})
function eligible(item:WishItem) {return !demo && store.online.value && store.editableList(item.list_id) && !['paused','pending','missing'].includes(trackingHealth(item,now.value))}
function select(id:string,checked:boolean) {
  if(!checked)selectedIds.value=selectedIds.value.filter(value=>value!==id)
  else if(selectedIds.value.length<10)selectedIds.value.push(id)
  else message.value='Select up to 10 wishes per retry batch.'
}
function selectFailed() {selectedIds.value=visible.value.filter(i=>trackingHealth(i,now.value)==='failed'&&eligible(i)).slice(0,10).map(i=>i.id)}
function open(item:WishItem,view:'detail'|'edit'|'repair'='detail') {selected.value=item;modal.value=view;error.value=''}
async function retry(ids:string[]) {
  if(running.value)return
  const account=user.value?.id,current=++generation
  const candidates=ids.map(id=>store.items.value.find(i=>i.id===id)).filter((i):i is WishItem=>!!i&&eligible(i)).slice(0,10)
  if(!candidates.length)return
  results.value=Object.fromEntries(candidates.map(i=>[i.id,{state:'queued',message:'Waiting'}]));error.value='';message.value=''
  // One request at a time respects the lookup budget and keeps per-item failures visible.
  for(const item of candidates) {
    if(current!==generation || user.value?.id!==account) return
    if(!navigator.onLine) {results.value[item.id]={state:'error',message:'Offline. This wish has not been retried.'};continue}
    results.value[item.id]={state:'running',message:'Checking saved product pages…'}
    try {
      const response=await api<{status:'ok'|'failed'|'skipped'|'background'}>(`/api/items/${item.id}/refresh`,{method:'POST',accountId:account,timeout:30000})
      if(current!==generation || user.value?.id!==account)return
      results.value[item.id]={state:response.status,message:response.status==='background'?'Home Depot check queued. Reload in a few minutes for the result.':response.status==='ok'?'Price check finished.':response.status==='failed'?'Check failed; previous prices kept.':'Skipped: checked recently, already running, or paused.'}
    }catch(e:any){
      if(current!==generation || user.value?.id!==account)return
      const reason=e.data?.statusMessage||e.message||'This check could not finish.'
      results.value[item.id]={state:'error',message:reason}
      const status=Number(e.statusCode||e.status||e.response?.status||0)
      if(status===401 || status===429){for(const pending of candidates)if(results.value[pending.id]?.state==='queued')results.value[pending.id]={state:'error',message:status===429?'Not retried: daily lookup limit reached.':'Not retried: sign in again.'};break}
    }
  }
  if(current!==generation || user.value?.id!==account)return
  await store.load().catch(()=>{error.value='Checks finished, but saved prices could not reload. Retry loading the dashboard.'})
  await tracking.load();selectedIds.value=[];now.value=Date.now()
}
async function save(product:ProductDraft) {
  if(!selected.value)return
  busy.value=true;error.value=''
  try{await store.saveItem(product,null,selected.value.id,undefined,undefined,selected.value.list_id);modal.value=null;message.value='Tracking details saved. Retry the price check when ready.'}
  catch(e:any){error.value=e.data?.statusMessage||e.message||'Changes could not be saved.'}
  finally{busy.value=false}
}
async function read(id?:string) {busy.value=true;error.value='';try{await tracking.markRead(id)}catch(e:any){error.value=e.data?.statusMessage||e.message||'Alerts could not be updated.'}finally{busy.value=false}}
const date=(value:string|null)=>value?new Date(value).toLocaleString('en-US'):'Not yet'
</script>
<template>
  <main class="feature-page tracking-page"><OskBrand /><NuxtLink to="/" class="feature-back">← Back to wishes</NuxtLink><header class="feature-header"><span class="eyebrow">A LITTLE PATIENCE, BETTER INFORMED</span><h1>Tracking &amp; alerts</h1><p>Your saved prices, the checks that need attention, and the moments worth a look.</p></header>
    <p v-if="demo" class="note-box">Preview · sample prices and local targets. Live checks and real alerts begin after setup.</p>
    <p v-else-if="!store.online.value || tracking.cached.value" class="note-box">Showing saved data. Reconnect and reload to see the latest prices and alerts. Changing targets and retrying checks require a connection.</p>
    <div class="tracking-tabs" role="group" aria-label="Tracking views"><button class="secondary-button" :aria-pressed="tab==='health'" @click="tab='health'">Tracking dashboard</button><button class="secondary-button" :aria-pressed="tab==='alerts'" @click="tab='alerts'">Price alerts{{ tracking.unread.value?` (${tracking.unread.value} unread)`:'' }}</button></div>
    <p v-if="loading" role="status">Loading your saved wishes…</p><p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="tracking.error.value" class="error-message" role="alert">{{ tracking.error.value }} <button class="text-button" :disabled="!demo && !store.online.value" @click="tracking.load">Retry alerts</button></p>
    <template v-if="!loading && tab==='health'">
      <section class="tracking-metrics" aria-label="Tracking overview"><button v-for="key in (['fresh','stale','failed','never','missing','paused'] as const)" :key="key" :aria-pressed="health===key" @click="health=health===key?'all':key"><strong>{{ metrics[key] }}</strong><span>{{ healthLabels[key] }}</span></button></section>
      <section class="feature-panel form-stack"><div class="tracking-filters"><label>Search tracked wishes<input v-model="query" type="search" placeholder="Product, variant, or failure reason…" /></label><label>Wishlist<select v-model="listId"><option value="">All accessible lists</option><option v-for="list in store.lists.value" :key="list.id" :value="list.id">{{ list.name }}</option></select></label><label>Tracking status<select v-model="health"><option value="all">All statuses</option><option v-for="(label,key) in healthLabels" :key="key" :value="key">{{ label }}</option></select></label></div>
        <div class="bulk-actions"><button class="text-button" :disabled="demo || running || !store.online.value" @click="selectFailed">Select failed checks</button><span>{{ selectedIds.length }} / 10 selected</span><button class="secondary-button" :disabled="!selectedIds.length || running || demo || !store.online.value" @click="retry(selectedIds)">Retry selected checks</button><button class="text-button" :disabled="running" @click="store.load().catch(()=>{error='Could not reload saved wishes.'});tracking.load()">Reload dashboard</button></div>
        <p class="field-note">Retries use the existing allowance of 20 checks/lookups per account per UTC day. Each request rechecks editing access. Blocked stores may need a corrected link or manual price.</p>
        <p v-if="progress.total" class="note-box" role="status">{{ progress.done }} / {{ progress.total }} checks finished{{ running?' · keep this page open while the queue runs':'' }}.</p>
        <p v-if="message" class="success-message" role="status">{{ message }}</p>
        <p v-if="!visible.length" class="empty-inline">No wishes match these filters.</p>
        <article v-for="item in visible" :key="item.id" class="tracking-row"><div class="tracking-item-heading"><label class="tracking-checkbox"><input type="checkbox" :checked="selectedIds.includes(item.id)" :disabled="!eligible(item) || running" :aria-label="`Select ${item.name} for price check`" @change="select(item.id,($event.target as HTMLInputElement).checked)" /><span class="sr-only">Select wish</span></label><div><button class="text-button tracking-item-title" @click="open(item)">{{ item.name }}</button><p class="field-note">{{ item.variant || 'No variant specified' }} · {{ store.lists.value.find(l=>l.id===item.list_id)?.name }}</p></div><span class="mini-badge">{{ healthLabels[trackingHealth(item,now)] }}</span></div>
          <div class="tracking-row-details"><p><strong>{{ bestOffer(item.offers)?money(bestOffer(item.offers)!.price_cents):'Price unknown' }}</strong><span class="field-note">{{ tracking.data.value.watches.find(w=>w.item_id===item.id)?` · Your target: ${money(tracking.data.value.watches.find(w=>w.item_id===item.id)!.target_cents)}`:' · No personal target' }}</span></p><p class="field-note">Last successful check: {{ date(item.checked_at) }}<br />Last attempt: {{ date(item.last_attempt_at) }}</p><p class="field-note">{{ trackingReason(item) }}</p><p v-if="results[item.id]" class="tracking-result" :class="{'error-message':['failed','error'].includes(results[item.id]!.state)}" aria-live="polite">{{ results[item.id]!.message }}</p><div class="archive-actions"><button class="secondary-button" :disabled="!eligible(item) || running" @click="retry([item.id])">Retry check</button><button class="text-button" @click="open(item)">Details &amp; target</button><button v-if="store.editableList(item.list_id)" class="text-button" :disabled="running || (!demo && (!store.online.value || item.pending_sync))" @click="open(item,'repair')">Fix tracking</button><button v-if="store.editableList(item.list_id)" class="text-button" :disabled="running || (!demo && (!store.online.value || item.pending_sync))" @click="open(item,'edit')">Edit links &amp; price</button></div></div>
        </article>
      </section>
    </template>
    <section v-if="!loading && tab==='alerts'" class="feature-panel form-stack" aria-label="Your price alerts"><div class="section-label"><h2>Your price alerts</h2><button class="text-button" :disabled="busy || !tracking.unread.value || (!demo && !store.online.value)" @click="read()">Mark all as read</button></div><p class="field-note">Only your targets appear here. A successful check notifies once when a price reaches the target; another alert needs a verified rise above it and a later drop. The latest 100 alerts are shown.</p><p v-if="!alertItems.length" class="empty-inline">No price alerts yet. Open a wish and set your target price to start watching.</p>
      <article v-for="alert in alertItems" :key="alert.id" class="price-alert-row"><div class="section-label"><strong>{{ alert.name }}</strong><span class="mini-badge">{{ alert.read_at?'Read':'Unread' }}</span></div><p v-if="alert.variant" class="field-note">{{ alert.variant }}</p><p><strong>{{ money(alert.price_cents) }}</strong> at {{ alert.offer.retailer }} · target {{ money(alert.target_cents) }}</p><p class="field-note">Observed {{ date(alert.observed_at) }} · {{ alert.offer.availability==='in_stock'?'In stock when checked':'Stock not verified' }} · {{ alert.offer.us_shipping==='confirmed'?'US shipping reported':'US shipping not verified' }}</p><p v-if="alert.offer.shipping_note" class="note-box">{{ alert.offer.shipping_note }}</p><div class="archive-actions"><a class="secondary-button" :href="alert.offer.url" target="_blank" rel="noopener noreferrer">Open store ↗</a><button class="text-button" @click="open(store.items.value.find(i=>i.id===alert.item_id)!)">View wish</button><button v-if="!alert.read_at" class="text-button" :disabled="busy || (!demo && !store.online.value)" @click="read(alert.id)">Mark as read</button></div></article>
      <p class="field-note">Prices exclude tax and shipping. Confirm the exact variant, seller, stock, and any coupon or membership requirements at checkout. Notifications refresh while Ósk is open or on your next online visit; no email or closed-app push is sent.</p>
    </section>
    <WishModal v-if="modal && selected" :title="modal==='repair'?'Fix price tracking':modal==='edit'?'Edit tracking details':selected.name" wide @close="modal=null"><ProductDetails v-if="modal==='detail'" :item="selected" :demo="demo" /><TrackingRepair v-else-if="modal==='repair'" :item="selected" :saving="busy" @save="save" @manual="modal='edit'" /><ItemEditor v-else :item="selected" :busy="busy" @save="save" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
  </main>
</template>
