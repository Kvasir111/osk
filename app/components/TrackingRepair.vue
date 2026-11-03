<script setup lang="ts">
import type { ProductDraft, SearchResult, WishItem } from '../../shared/types'
import { productSchema } from '../../shared/validation'
import { captureUrl } from '../../shared/capture'
import { comparisonSearch, repairProduct, trackingLinks } from '../../shared/tracking'
import { money } from '../../shared/pricing'
const props = defineProps<{ item: WishItem; saving?: boolean }>()
const emit = defineEmits<{ save: [product: ProductDraft]; manual: [] }>()
const { api, user } = useAccount()
const accountAtOpen = user.value?.id
const sameAccount = computed(() => user.value?.id === accountAtOpen)
const online = useState('offline-online', () => true)
const links = computed(() => trackingLinks(props.item))
const replaced = ref(links.value[0] || '')
const query = ref(replaced.value)
const option = ref('')
const result = ref<SearchResult | null>(null)
const reading = ref(false)
const error = ref('')
const previewUrl = ref('')
let revision = 0
onBeforeUnmount(() => { revision++ })
watch(() => user.value?.id, () => { revision++; result.value = null; reading.value = false })
function changeSource() { query.value = replaced.value; result.value = null }
const baseUrl = computed(() => {
  const value = captureUrl(query.value)
  if (!value) return ''
  const url = new URL(value)
  for (const key of ['sku', 'b', 'variant', 'color', 'size']) url.searchParams.delete(key)
  return url.href === value ? '' : url.href
})
async function read(value = query.value) {
  const url = captureUrl(value)
  if (reading.value || props.saving || !sameAccount.value) return
  if (!online.value) { error.value = 'Reconnect before comparing or correcting a listing.'; return }
  if (!url) { error.value = 'Use a public HTTPS product link.'; return }
  const version = ++revision, account = user.value?.id
  query.value = url; result.value = null; option.value = ''; reading.value = true; error.value = ''
  try {
    const found = await api<SearchResult>('/api/capture', { method: 'POST', body: { url }, accountId: account, timeout: 12000 })
    if (version === revision && account === user.value?.id) { result.value = found; previewUrl.value = url; option.value = found.variants?.some(variant => variant.url === url) ? url : '' }
  } catch { if (version === revision && account === user.value?.id) error.value = 'This page could not be read. You can still edit the item manually or try another store link.' }
  finally { if (version === revision) reading.value = false }
}
function approve(product: ProductDraft) {
  if (!result.value || reading.value || props.saving || !product.offers.length || !sameAccount.value || !online.value || option.value && option.value !== previewUrl.value) return
  const draft = repairProduct(props.item, product, replaced.value, previewUrl.value)
  const parsed = productSchema.safeParse(draft)
  if (!parsed.success) { error.value = draft.offers.length > 10 ? 'This would exceed ten store offers. Use Edit item manually to remove a store first.' : parsed.error.issues[0]?.message || 'Check the corrected details.'; return }
  emit('save', parsed.data)
}
</script>
<template>
  <div v-if="sameAccount" class="form-stack">
    <p>Compare your saved wish with the store’s exact listing. Reading a page changes nothing until you approve.</p>
    <p v-if="!online" class="note-box">Reconnect to compare listings or save tracking corrections.</p>
    <section class="note-box" aria-label="Saved tracking details"><h3>Saved item</h3><p>{{ item.name }}</p><p>{{ item.variant || 'No exact variant saved' }}</p></section>
    <label v-if="links.length">Saved link to replace<select v-model="replaced" :disabled="reading || saving" @change="changeSource"><option v-for="link in links" :key="link" :value="link">{{ link }}</option></select></label>
    <form class="form-stack" @submit.prevent="read()"><label>Correct product link<input v-model="query" type="url" required maxlength="2048" :disabled="reading || saving" placeholder="https://store.com/exact-option" @input="result = null" /></label><button class="primary-button" :disabled="reading || saving">{{ reading ? 'Reading…' : 'Compare listing' }}</button></form>
    <button v-if="baseUrl" type="button" class="secondary-button" :disabled="reading || saving" @click="read(baseUrl)">Read product options</button>
    <p v-if="reading" role="status">Reading the listing… Your saved wish stays unchanged.</p>
    <template v-if="result">
      <div v-if="result.warnings?.length" class="coverage-warning"><p v-for="warning in result.warnings" :key="warning">{{ warning }}</p></div>
      <div v-if="result.variants?.length" class="form-stack"><label>Exact store option<select v-model="option" :disabled="saving || reading"><option value="" disabled>Choose your color, size, or configuration</option><option v-for="variant in result.variants" :key="variant.url" :value="variant.url">{{ variant.label }}</option></select></label><button class="secondary-button" :disabled="!option || reading || saving" @click="read(option)">Compare selected option</button></div>
      <p v-if="!result.products.length" class="note-box">The store did not provide readable product details. Keep the price manual or try another listing.</p>
      <section v-for="(product, index) in result.products" :key="index" class="search-result form-stack" aria-label="Detected tracking details"><h3>Store listing</h3><strong>{{ product.name }}</strong><p>{{ product.variant || 'No exact variant confirmed' }}</p><p v-for="offer in product.offers" :key="offer.url"><a :href="offer.url" target="_blank" rel="noopener noreferrer">{{ offer.retailer }} ↗</a> · {{ money(offer.price_cents) }}</p>
        <p class="field-note">Approving replaces the selected link and adopts this name and variant. If the identity changes, previous offers and the old MSRP baseline are cleared. Your category, personal notes, and custom picture are kept. Imported prices remain unverified until a subsequent price check.</p>
        <p v-if="!product.offers.length" class="field-note">Choose an exact option with a price before approving, or edit the item manually.</p>
        <p v-if="option && option !== previewUrl" class="field-note">Compare the selected option before approving.</p>
        <button class="primary-button" :disabled="!product.offers.length || saving || reading || !!option && option !== previewUrl" @click="approve(product)">{{ saving ? 'Saving…' : 'Approve tracking correction' }}</button>
      </section>
    </template>
    <a :href="comparisonSearch(item.name, item.variant)" target="_blank" rel="noopener noreferrer" class="text-button">Search other US stores ↗</a>
    <p class="field-note">Search opens in another tab. Paste an exact product link here to compare it; searches never save automatically.</p>
    <button class="secondary-button" :disabled="saving" @click="$emit('manual')">Edit item manually</button>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
  </div>
  <p v-else class="note-box">Your account changed. Close this dialog and open a wish from your current account.</p>
</template>
