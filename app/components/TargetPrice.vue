<script setup lang="ts">
import type { WishItem } from '../../shared/types'
import {money} from '../../shared/pricing'
const props=defineProps<{item:WishItem}>()
const {demo}=useAccount()
const tracking=usePriceTracking()
const online=useState('offline-online',()=>true)
const watchRecord=computed(()=>tracking.data.value.watches.find(w=>w.item_id===props.item.id))
const amount=ref(''),dirty=ref(false),busy=ref(false),error=ref(''),success=ref('')
const disabled=computed(()=>busy.value || (!demo && (!online.value || props.item.pending_sync)) || (!!props.item.status && props.item.status!=='active'))
watch(()=>[props.item.id,watchRecord.value?.target_cents] as const,()=>{
  if(!dirty.value)amount.value=watchRecord.value?String(watchRecord.value.target_cents/100):''
},{immediate:true})
watch(()=>props.item.id,()=>{dirty.value=false;amount.value=watchRecord.value?String(watchRecord.value.target_cents/100):'';error.value='';success.value=''})
onMounted(()=>tracking.load())
async function save(remove=false) {
  if(remove ? busy.value || (!demo && (!online.value || props.item.pending_sync)) : disabled.value)return
  busy.value=true;error.value='';success.value=''
  try {
    if(remove)await tracking.removeTarget(props.item.id)
    else await tracking.setTarget(props.item.id,Math.round(Number(amount.value)*100))
    dirty.value=false;amount.value=watchRecord.value?String(watchRecord.value.target_cents/100):''
    success.value=remove?'Target removed.':demo?'Sample target saved on this device.':'Target saved. Alerts start with the next successful price check.'
  }catch(e:any){error.value=e.data?.statusMessage||e.message||'Your target could not be saved.'}
  finally{busy.value=false}
}
</script>
<template>
  <section class="target-price-panel form-stack" aria-label="Your target price">
    <div><h3>Your target price</h3><p class="field-note">Private to your account. Alert me when a checked listing is at or below this price.</p></div>
    <p v-if="tracking.error.value" class="error-message" role="alert">{{ tracking.error.value }} <button class="text-button" :disabled="!demo && !online" @click="tracking.load">Retry targets</button></p>
    <p v-if="!tracking.loaded.value && !tracking.error.value" class="field-note">{{ online?'Loading your target…':'Connect once to load your price targets.' }}</p>
    <form v-if="tracking.loaded.value" class="form-stack" @submit.prevent="save()"><label>Target price in USD<input v-model="amount" type="number" required min="0.01" max="1000000" step="0.01" placeholder="e.g. 50.00" :disabled="disabled" @input="dirty=true;success=''" /></label><div class="archive-actions"><button class="secondary-button" :disabled="disabled">{{ busy?'Saving…':watchRecord?'Update target':'Set target' }}</button><button v-if="watchRecord" type="button" class="text-button" :disabled="busy || (!demo && (!online || item.pending_sync))" @click="save(true)">Remove target</button></div></form>
    <p v-if="watchRecord?.last_checked_at && watchRecord.last_price_cents" class="field-note">Last target check: {{ money(watchRecord.last_price_cents) }} on {{ new Date(watchRecord.last_checked_at).toLocaleString('en-US') }}{{ watchRecord.is_met?' · target reached':'' }}.</p>
    <p class="field-note">{{ demo?'Demo targets stay on this device. Real alerts begin after setup.':'Alerts appear here and in Tracking & alerts. Manual prices and failed checks do not trigger them. Prices exclude tax and shipping; store conditions still apply.' }}</p>
    <p v-if="!demo && (!online || item.pending_sync)" class="field-note">Sync and reconnect before changing a target.</p>
    <p v-if="item.status && item.status!=='active'" class="field-note">Targets pause while this wish is received or archived.</p>
    <p v-if="success" class="success-message" role="status">{{ success }}</p><p v-if="error" class="error-message" role="alert">{{ error }}</p>
  </section>
</template>
