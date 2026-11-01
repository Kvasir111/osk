<script setup lang="ts">
import type { ProductDraft, PriceCheckDetails } from '../../shared/types'
import { captureUrl, sharedCapture } from '../../shared/capture'
const { user, demo } = useAccount()
const store = useWishlists()
const route = useRoute()
const incoming = computed(() => sharedCapture(route.query))
const url = ref(incoming.value.url)
const sharedTitle = ref(incoming.value.title)
const manualName = ref('')
const lookup = ref('')
const resumeId=ref(typeof route.query.search==='string'?route.query.search:'')
const manual = ref(false)
const saving = ref(false)
const loading = ref(true)
const error = ref('')
const success = ref('')
const chosenList = ref('')
const editableLists = computed(() => store.lists.value.filter(l => demo || l.owner_id === user.value?.id || store.roles.value[l.id] === 'editor'))
watch(() => route.fullPath, () => {
  url.value = incoming.value.url; sharedTitle.value = incoming.value.title
  lookup.value = ''; resumeId.value = ''; manual.value = false; error.value = ''; success.value = ''
})
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
onMounted(async () => {
  if (!demo && !user.value) { await navigateTo({ path: '/login', query: { next: route.fullPath } }); return }
  try {
    await store.load()
    chosenList.value = editableLists.value.find(l => l.id === store.activeId.value)?.id || editableLists.value[0]?.id || ''
  } catch { error.value = 'Your lists could not load. Please reload to try again.' }
  finally { loading.value = false }
})
function find() {
  error.value = ''; success.value = ''
  const parsed = captureUrl(url.value)
  if (!parsed) { error.value = 'Paste a public HTTPS product link.'; return }
  url.value = parsed; resumeId.value=''; lookup.value = parsed
}
function manually(candidate?: string, name?: string) {
  const parsed = captureUrl(candidate || url.value)
  if (!parsed && name === undefined) { error.value = 'Paste a public HTTPS product link first.'; return }
  manualName.value = name || sharedTitle.value
  url.value = parsed || ''; error.value = ''; lookup.value = ''; resumeId.value=''; manual.value = true
}
async function approve(product: ProductDraft, checkedAt: string | null = null, details?: PriceCheckDetails, searchId?: string) {
  if (!editableLists.value.some(l => l.id === chosenList.value)) { error.value = 'Choose a list you can edit.'; return }
  saving.value = true; error.value = ''
  try {
    store.activeId.value = chosenList.value
    await store.saveItem(product, checkedAt, undefined, details, searchId)
    lookup.value = ''; resumeId.value=''; manual.value = false; success.value = `${product.name} added to ${store.active.value?.name}.`
  } catch (e: any) { error.value = e.data?.statusMessage || e.message || 'Could not save this wish.' }
  finally { saving.value = false }
}
</script>
<template>
  <main class="feature-page capture-page"><OskBrand /><NuxtLink to="/" class="feature-back">← Back to wishes</NuxtLink><header class="feature-header"><span class="eyebrow">FROM ANY STORE, TO YOUR LIST</span><h1>Quick capture</h1><p>Found something you love? Start with a product link, or take a photo and jot down the details for later.</p></header>
    <p v-if="incoming.received && !success" class="note-box" role="status">{{ incoming.url ? 'Shared link received. Choose a list, then review the product or enter its details.' : 'This share did not include a public HTTPS product link. Copy the product link from your browser and paste it below.' }}</p>
    <details class="feature-panel form-stack"><summary>Save from your phone’s share menu</summary><p class="field-note">On supported Android browsers, install Ósk, then open a product page, tap Share, and choose Ósk. You’ll choose a list and review before saving. If Ósk doesn’t appear, reopen or reinstall the updated app.</p><p class="field-note">On iPhone, iPad, or other browsers, choose Copy Link in the share menu, open Ósk → Quick capture, and paste it below. While offline, enter details manually; the wish will sync when you’re back online. Shared titles are suggestions, not verified product details.</p></details>
    <PhotoQuickAdd v-if="!loading && editableLists.length" :lists="editableLists" :initial-list-id="chosenList" />
    <section class="feature-panel form-stack"><p v-if="loading" role="status">Loading your lists…</p><template v-else><form class="form-stack" @submit.prevent="find"><label>Save to wishlist<select v-model="chosenList" required><option value="" disabled>Choose a list</option><option v-for="list in editableLists" :key="list.id" :value="list.id">{{ list.name }}</option></select></label><label>Product link<input v-model="url" type="url" required maxlength="2048" placeholder="https://store.com/product" /></label><button class="primary-button" :disabled="!chosenList || saving">Preview product & prices<WishIcon name="arrow" :size="17" /></button><button type="button" class="text-button" :disabled="!chosenList || saving" @click="manually()">Enter details manually from this link</button></form><p v-if="!editableLists.length" class="note-box"><NuxtLink to="/">Create a wishlist first →</NuxtLink></p><p class="field-note">You’ll review the exact model and variant before adding anything. If a store blocks access, you can enter the details yourself. Manual prices won’t count toward sale history.</p></template><p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="success" class="success-message" role="status">{{ success }} <NuxtLink to="/">View your list →</NuxtLink></p></section>
    <WishModal v-if="lookup || resumeId" :key="lookup || resumeId" title="Review your captured wish." wide @close="lookup = ''; resumeId = ''"><ProductSearch :initial-query="lookup" :resume-id="resumeId || undefined" :saving="saving" @approve="approve" @manual="manually" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
    <WishModal v-if="manual" title="A few details, for your wish." wide @close="manual = false"><ItemEditor :initial-url="url || undefined" :initial-name="manualName" :busy="saving" @save="approve" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
  </main>
</template>
