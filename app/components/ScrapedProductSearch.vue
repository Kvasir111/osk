<script setup lang="ts">
import type { ProductDraft, PriceCheckDetails, SearchResult, ProductSearchJob } from '../../shared/types'
import { captureUrl } from '../../shared/capture'
import { money } from '../../shared/pricing'
const props = defineProps<{ initialQuery: string; saving?: boolean; resumeId?: string }>()
const emit = defineEmits<{ approve: [product: ProductDraft, checkedAt: string, details: PriceCheckDetails]; manual: [url?: string, name?: string] }>()
const { api, demo, user } = useAccount()
const query = ref(props.initialQuery)
const result = ref<SearchResult | null>(null)
const busy = ref(false)
const error = ref('')
const selectedOption = ref('')
let revision = 0
onBeforeUnmount(() => { revision++ })
async function read() {
  const url = captureUrl(query.value)
  error.value = ''
  if (!url) { error.value = 'Paste a public HTTPS product link, or enter the item manually.'; return }
  if (demo) return
  const version = ++revision, account = user.value?.id
  busy.value = true; result.value = null; selectedOption.value = ''
  try {
    const found = await api<SearchResult>('/api/capture', { method: 'POST', body: { url }, accountId: account, timeout: 12000 })
    if (version === revision && account === user.value?.id) result.value = found
  } catch (e: any) {
    if (version === revision && account === user.value?.id) error.value = e.data?.statusMessage || 'This store’s page could not be read. You can enter the details manually.'
  } finally { if (version === revision) busy.value = false }
}
onMounted(async () => {
  const version = revision, account = user.value?.id
  if (props.resumeId && !demo) {
    busy.value = true
    try {
      const old = await api<ProductSearchJob>(`/api/searches/${props.resumeId}`, { accountId: account, timeout: 10000 })
      if (version !== revision || account !== user.value?.id) return
      query.value = old.product_url || old.query
      error.value = 'AI research is disabled. Read this product link directly, or enter the item manually.'
    } catch { if (version === revision) error.value = 'This old research is unavailable. Paste a product link or enter the wish manually.' }
    finally { if (version === revision) busy.value = false }
  } else if (captureUrl(query.value)) await read()
})
function manual() {
  const url = captureUrl(query.value)
  emit('manual', url || undefined, url ? undefined : query.value.trim().slice(0,200))
}
function readOption() {
  if (!result.value?.variants?.some(option => option.url === selectedOption.value)) return
  query.value = selectedOption.value
  return read()
}
function approve(product: ProductDraft) {
  if (!result.value) return
  emit('approve', structuredClone(toRaw(product)), result.value.checked_at, { warnings: [...(result.value.warnings || [])], retailer_checks: structuredClone(toRaw(result.value.retailer_checks || [])) })
}
</script>
<template>
  <div class="form-stack">
    <p class="muted">Read details from a store’s product page. Review the exact item before saving.</p>
    <form class="search-form" @submit.prevent="read"><WishIcon name="link" :size="20" /><input v-model="query" aria-label="Product link to read" required maxlength="2048" placeholder="https://store.com/product" /><button class="primary-button" :disabled="busy || demo || saving">{{ busy ? 'Reading…' : 'Read product page' }}</button></form>
    <p class="field-note">Paste a product link rather than a name. Price checks revisit links you save; add other store links manually to compare them.</p>
    <p v-if="demo" class="note-box">Live page lookup needs a connected account. You can add wishes manually in this local demo.</p>
    <p v-if="busy" role="status">Reading the listing… You can enter details manually at any time.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button type="button" class="secondary-button" :disabled="saving" @click="manual">Enter details manually{{ captureUrl(query) ? ' from this link' : '' }}</button>
    <template v-if="result">
      <p>{{ result.summary }}</p>
      <div v-if="result.warnings?.length" class="coverage-warning" role="status"><p v-for="warning in result.warnings" :key="warning">{{ warning }}</p></div>
      <div v-if="result.variants?.length" class="form-stack">
        <label>Product option<select v-model="selectedOption"><option value="" disabled>Choose an exact option</option><option v-for="option in result.variants" :key="option.url" :value="option.url">{{ option.label }}</option></select></label>
        <button type="button" class="secondary-button" :disabled="!selectedOption || busy || saving" @click="readOption">Read selected option</button>
        <p class="field-note">Options come from the store’s page. Check the configuration on the store before approving; customizations may change its price.</p>
      </div>
      <p v-if="!result.products.length" class="empty-inline">No reliable details were found. Keep the link and enter the wish manually.</p>
      <article v-for="(product, index) in result.products" :key="index" class="search-result"><div class="result-header"><div><span class="eyebrow">{{ product.category }}</span><h3>{{ product.name }}</h3><p class="muted">{{ product.variant }}</p></div><div class="search-product-picture"><ProductPicture :product="product" /></div></div>
        <p class="field-note">{{ product.msrp_cents ? `Manufacturer MSRP: ${money(product.msrp_cents)}` : 'Manufacturer MSRP unknown' }}</p>
        <div v-for="offer in product.offers" :key="offer.url" class="result-offer"><a :href="offer.url" target="_blank" rel="noopener noreferrer">{{ offer.retailer }} ↗</a><strong>{{ money(offer.price_cents) }}</strong><small>{{ offer.shipping_note }}</small></div>
        <p v-if="!product.offers.length" class="field-note">No price verified. You can still save this product.</p>
        <button class="primary-button full" :disabled="saving" @click="approve(product)">{{ saving ? 'Adding…' : 'Approve & add to list' }}</button>
      </article>
      <p class="field-note">Prices come from page metadata. Confirm size, color, seller, shipping, and checkout price. Nothing is added without approval.</p>
    </template>
  </div>
</template>
