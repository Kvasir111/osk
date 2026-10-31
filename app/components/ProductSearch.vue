<script setup lang="ts">
import type { ProductDraft, PriceCheckDetails } from '../../shared/types'
import { captureUrl } from '../../shared/capture'
import { money } from '../../shared/pricing'
import { retailerCount } from '../../shared/retailers'
const props = defineProps<{ initialQuery: string; saving?: boolean; resumeId?: string }>()
const emit = defineEmits<{ approve: [product: ProductDraft, checkedAt: string, details: PriceCheckDetails, searchId: string]; manual: [url?: string] }>()
const { demo } = useAccount()
const {jobs,start,fetchJob}=useSearchJobs()
const query = ref(props.initialQuery)
const starting = ref(false)
const error = ref('')
const jobId=ref(props.resumeId||'')
const job=computed(()=>jobs.value[jobId.value])
const result=computed(()=>job.value?.result||null)
const busy=computed(()=>starting.value||!!job.value&&['queued','running'].includes(job.value.status))
async function search() {
  if (demo) return
  starting.value=true;error.value=''
  try {
    const url=captureUrl(query.value)
    const created=await start(url?{url}:{query:query.value})
    jobId.value=created.id
  }catch(e:any){error.value=e.data?.statusMessage||'Search could not start. Please try again.'}
  finally{starting.value=false}
}
onMounted(async()=>{
  if(props.resumeId&&!demo){
    starting.value=true
    try{const restored=await fetchJob(props.resumeId);query.value=restored.product_url||restored.query}
    catch{error.value='This search is unavailable. You can start a new one.'}
    finally{starting.value=false}
  }else if(props.initialQuery.trim().length>=3)search()
})
function manual(){emit('manual',captureUrl(query.value)||undefined)}
function approve(product:ProductDraft){emit('approve',structuredClone(toRaw(product)),result.value!.checked_at,{warnings:[...(result.value!.warnings||[])],retailer_checks:structuredClone(toRaw(result.value!.retailer_checks||[]))},jobId.value)}
</script>
<template>
  <div class="form-stack">
    <p class="muted">Find the exact thing. Compare stores. You choose what makes the list.</p>
    <form class="search-form" @submit.prevent="search"><WishIcon name="sparkle" :size="20" /><input v-model="query" aria-label="Product to search for" required minlength="3" maxlength="1000" placeholder="A product name, model, or product URL…" /><button class="primary-button" :disabled="busy || demo || saving">{{ busy ? 'Searching…' : job ? 'Search again' : 'Find it' }}</button></form>
    <div v-if="demo" class="setup-note"><WishIcon name="sparkle" :size="26" /><h3>Your shopping companion, soon.</h3><p>Live product search will be available when accounts and search are connected. You can try making lists and adding items manually now.</p><button class="secondary-button" @click="manual">Add an item manually</button></div>
    <div v-if="busy&&!result" class="search-loading" role="status"><WishIcon name="sparkle" :size="32" class="pulse" /><h3>Identifying your product.</h3><p>{{ captureUrl(query)?'Reading the exact listing first.':'Finding the product and manufacturer.' }} You can leave this dialog; research keeps running.</p></div>
    <section v-if="job" class="research-progress" aria-label="Search progress"><div v-for="stage in job.stages" :key="stage.id"><span>{{ stage.label }}</span><strong>{{ stage.status==='waiting'?'Waiting':stage.status==='running'?'Checking…':stage.status==='failed'?'Unverified':'Finished' }}</strong></div><p v-if="busy&&result" class="field-note" role="status">Your product is ready to review. Store comparisons continue in the background, including after you save it.</p></section>
    <p v-if="job?.error_message" class="error-message" role="alert">{{ job.error_message }}</p>
    <p v-if="job?.approved_item_id" class="success-message" role="status">This wish is already saved. {{ busy?'The remaining prices will be added automatically if you haven’t edited the item.':'Available results have been processed for your saved item.' }}</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button v-if="!demo && (error || result)" class="secondary-button" @click="manual">Enter details manually{{ captureUrl(query) ? ' from this link' : '' }}</button>
    <template v-if="result">
      <p class="search-summary">{{ result.summary }}</p>
      <div v-if="result.warnings?.length" class="coverage-warning" role="status"><strong>Some prices are still unverified</strong><p v-for="warning in result.warnings" :key="warning">{{ warning }}</p></div>
      <p v-if="!result.products.length" class="empty-inline">No reliable matches yet. Try including a model number or add it manually.</p>
      <article v-for="(product, index) in result.products" :key="index" class="search-result">
        <div class="result-header"><div><span class="eyebrow">{{ product.category }}</span><h3>{{ product.name }}</h3><p class="muted">{{ product.variant }}</p></div><div class="search-product-picture"><ProductPicture :product="product" /></div></div>
        <p v-if="product.msrp_cents" class="muted">MSRP <a :href="product.msrp_source_url!" target="_blank" rel="noopener noreferrer">{{ money(product.msrp_cents) }} ↗</a></p><p v-else class="muted">MSRP unknown</p>
        <p class="field-note">Retailer coverage: {{ retailerCount(product) }} / 2 stores beyond the manufacturer{{ retailerCount(product) < 2 ? ' · incomplete comparison' : '' }}.</p>
        <div v-for="offer in product.offers" :key="offer.url" class="result-offer"><a :href="offer.url" target="_blank" rel="noopener noreferrer">{{ offer.retailer }} ↗</a><strong>{{ money(offer.price_cents) }}</strong><small>{{ offer.seller_type === 'marketplace' ? 'Third-party seller · ' : '' }}{{ offer.us_shipping === 'unknown' ? 'US shipping unverified' : 'US shipping reported' }} · {{ offer.availability === 'in_stock' ? 'In stock when checked' : 'Stock unverified' }}</small><small v-if="offer.shipping_note">{{ offer.shipping_note }}</small></div>
        <p v-if="!product.offers.length" class="field-note">No sourced prices available. You can still save this product.</p>
        <p v-if="product.notes" class="field-note">{{ product.notes }}</p>
        <button class="primary-button full" :disabled="saving || !!job?.approved_item_id" @click="approve(product)"><WishIcon name="check" :size="17" />{{ saving ? 'Adding…' : job?.approved_item_id ? 'Already saved' : 'Approve & add to list' }}</button>
      </article>
      <section v-if="result.retailer_checks?.length" class="retailer-checks"><h3>Retailers without a verified price</h3><div v-for="(check, index) in result.retailer_checks" :key="index" class="retailer-check"><a v-if="check.url" :href="check.url" target="_blank" rel="noopener noreferrer">{{ check.retailer }} ↗</a><strong v-else>{{ check.retailer }}</strong><p>{{ check.note }}</p></div></section>
      <p class="field-note">AI-reported prices exclude tax and shipping. Verify seller, model, and final price at checkout. Nothing is added without your approval.</p>
      <details v-if="result.sources.length" class="sources"><summary>Search sources ({{ result.sources.length }})</summary><a v-for="source in result.sources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a></details>
    </template>
  </div>
</template>
