<script setup lang="ts">
import type { ProductDraft, WishItem } from '../../shared/types'
import { productSchema, publicUrl } from '../../shared/validation'
const props = defineProps<{ item?: WishItem; busy?: boolean; initialUrl?: string; initialName?: string }>()
const emit = defineEmits<{ save: [product: ProductDraft] }>()
const form = reactive({ image_mode:props.item?.image_mode||'auto' as 'auto'|'custom'|'none', image_url:props.item?.image_url||'',image_source_url:props.item?.image_source_url||null, name: props.item?.name || '', variant: props.item?.variant || '', category: props.item?.category || 'Other',
  priority: props.item?.priority || 'idea', gift_preferences: props.item?.gift_preferences || '', status: props.item?.status || 'active',
  notes: props.item?.notes || '', msrp: props.item?.msrp_cents ? String(props.item.msrp_cents / 100) : '', msrp_source_url: props.item?.msrp_source_url || '',
  offers: props.item?.offers.map(o => ({ ...o, price: String(o.price_cents / 100) })) || [] as Array<{ retailer: string; url: string; price: string; seller_type: 'manufacturer' | 'retailer' | 'marketplace'; us_shipping: 'confirmed' | 'unknown'; availability: 'in_stock' | 'unknown'; shipping_note: string }>,
})
if (!form.offers.length) addOffer()
if (props.initialUrl && !props.item) {
  form.offers[0]!.url = props.initialUrl
  form.offers[0]!.retailer = new URL(props.initialUrl).hostname.replace(/^www\./, '')
}
if (!props.item && props.initialName) form.name = props.initialName.slice(0, 200)
const error = ref('')
const pictureError=ref(false)
watch(()=>[form.image_url,form.image_mode],()=>{pictureError.value=false})
watch(()=>form.image_mode,mode=>{if(mode!=='custom'){form.image_url='';form.image_source_url=null}})
function addOffer() { form.offers.push({ retailer: '', url: '', price: '', seller_type: 'retailer', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' }) }
function submit() {
  const filled = form.offers.filter(offer => offer.url || offer.price || offer.retailer)
  const unpriced = filled.filter(offer => !offer.price)
  if (unpriced.some(offer => !publicUrl.safeParse(offer.url).success)) { error.value = 'Use a public HTTPS product URL for each unpriced store.'; return }
  const links = [...new Set(unpriced.map(offer => offer.url))].filter(url => !form.notes.includes(url))
  const result = productSchema.safeParse({ ...form, image_url:form.image_mode==='none'?null:form.image_url||null,image_source_url:form.image_mode==='auto'?form.image_source_url:null, msrp_cents: form.msrp ? Math.round(Number(form.msrp) * 100) : null,
    msrp_source_url: form.msrp_source_url || null,
    notes: [form.notes, ...links.map(url => `Product link: ${url}`)].filter(Boolean).join('\n'),
    offers: filled.filter(o => !!o.price).map(o => ({ ...o, retailer: o.retailer || (() => { try { return new URL(o.url).hostname.replace(/^www\./, '') } catch { return '' } })(), price_cents: Math.round(Number(o.price) * 100) })) })
  if (!result.success) { error.value = result.error.issues[0]?.message || 'Please check the form.'; return }
  emit('save', result.data)
}
</script>
<template>
  <form class="form-stack" @submit.prevent="submit">
    <p class="muted">Save something from any store. Add a price now, or leave it for a later check.</p>
    <label>Product name<input v-model="form.name" required maxlength="200" placeholder="e.g. Razer DeathAdder V3" /></label>
    <div v-for="(offer, index) in form.offers" :key="index" class="offer-form">
      <label>Product URL<input v-model="offer.url" type="url" :required="!!offer.price" placeholder="https://… (optional)" /></label>
      <label>Price in USD<input v-model="offer.price" type="number" min="0.01" max="1000000" step="0.01" placeholder="Current price, if you know it" /></label>
      <details class="editor-options"><summary>Store and shipping details{{ index ? ` · store ${index + 1}` : '' }}</summary><div class="form-stack">
        <label>Store<input v-model="offer.retailer" maxlength="100" placeholder="Optional · uses the link’s store name" /></label>
        <div class="form-row"><label>Seller type<select v-model="offer.seller_type"><option value="manufacturer">Manufacturer</option><option value="retailer">Retailer</option><option value="marketplace">Third-party seller</option></select></label><label>US shipping<select v-model="offer.us_shipping"><option value="unknown">Not verified</option><option value="confirmed">Confirmed</option></select></label></div>
        <div class="form-row"><label>Availability<select v-model="offer.availability"><option value="unknown">Not verified</option><option value="in_stock">In stock</option></select></label><label>Shipping / offer details<input v-model="offer.shipping_note" maxlength="500" placeholder="Shipping cost, coupon, membership…" /></label></div>
        <button type="button" class="text-button danger" @click="form.offers.splice(index, 1)">Remove store</button>
      </div></details>
    </div>
    <p class="field-note">No price or link yet? Just a name is enough. Manual prices stay separate from verified sale history.</p>
    <button v-if="form.offers.length < 10" type="button" class="text-button" @click="addOffer"><WishIcon name="plus" :size="15" /> Add a store</button>
    <div class="form-row"><label>Exact variant<input v-model="form.variant" maxlength="200" placeholder="Size, color, model…" /></label><label>Category<select v-model="form.category"><option>Tech</option><option>Home</option><option>Style</option><option>Books</option><option>Outdoors</option><option>Other</option></select></label></div>
    <WishPreferences v-model:priority="form.priority" v-model:preferences="form.gift_preferences" />
    <label>A note for your people<textarea v-model="form.notes" maxlength="2000" rows="2" placeholder="The little details that help them get it right." /></label>
    <details class="editor-options" :open="!!item"><summary>Pictures and MSRP</summary><div class="form-stack">
    <fieldset class="picture-editor form-stack"><legend>Product picture</legend><label>Picture style<select v-model="form.image_mode"><option value="auto">Find automatically</option><option value="custom">Use an image link</option><option value="none">Use category artwork</option></select></label><label v-if="form.image_mode==='custom'">Picture URL<input v-model="form.image_url" type="url" required maxlength="2048" placeholder="https://…/product.jpg" /></label><p v-else-if="form.image_mode==='auto'" class="field-note">We’ll look for a picture on the product’s listing pages. The category artwork stays if one isn’t available.</p><button v-if="form.image_mode==='auto'&&form.image_url" type="button" class="text-button" @click="form.image_url='';form.image_source_url=null">Find a picture again when saved</button><div class="editor-product-picture"><ProductPicture :product="{name:form.name,variant:form.variant,category:form.category,image_url:form.image_url,image_mode:form.image_mode}" eager @error="pictureError=true" /></div><p v-if="pictureError" class="field-note">This picture couldn’t load. Try another image link or keep the category artwork.</p></fieldset>
    <div class="form-row"><label>MSRP in USD <span class="optional">optional</span><input v-model="form.msrp" type="number" min="0.01" step="0.01" max="1000000" placeholder="69.99" /></label><label>Manufacturer MSRP source<input v-model="form.msrp_source_url" type="url" :required="!!form.msrp" placeholder="https://manufacturer.com/product" /></label></div>
    <p class="field-note">MSRP is a comparison baseline, not a current store price. Enter the price you can buy it for in the current price field above. A store’s crossed-out price may be different from manufacturer MSRP.</p>
    <p v-if="form.msrp && !form.offers.some(offer => !!offer.price)" class="note-box" role="status">Only MSRP is entered. The card will show “Price unknown” until you add a current price in the current price field.</p>
    </div></details>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button class="primary-button full" :disabled="busy">{{ busy ? 'Saving…' : item ? 'Save changes' : 'Add to wishlist' }}<WishIcon name="arrow" :size="17" /></button>
  </form>
</template>
