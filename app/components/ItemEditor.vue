<script setup lang="ts">
import type { ProductDraft, WishItem } from '../../shared/types'
import { productSchema } from '../../shared/validation'
const props = defineProps<{ item?: WishItem; busy?: boolean; initialUrl?: string }>()
const emit = defineEmits<{ save: [product: ProductDraft] }>()
const form = reactive({ image_mode:props.item?.image_mode||'auto' as 'auto'|'custom'|'none', image_url:props.item?.image_url||'',image_source_url:props.item?.image_source_url||null, name: props.item?.name || '', variant: props.item?.variant || '', category: props.item?.category || 'Other',
  notes: props.item?.notes || '', msrp: props.item?.msrp_cents ? String(props.item.msrp_cents / 100) : '', msrp_source_url: props.item?.msrp_source_url || '',
  offers: props.item?.offers.map(o => ({ ...o, price: String(o.price_cents / 100) })) || [] as Array<{ retailer: string; url: string; price: string; seller_type: 'manufacturer' | 'retailer' | 'marketplace'; us_shipping: 'confirmed' | 'unknown'; availability: 'in_stock' | 'unknown'; shipping_note: string }>,
})
if (props.initialUrl && !props.item) {
  addOffer()
  form.offers[0]!.url = props.initialUrl
  form.offers[0]!.retailer = new URL(props.initialUrl).hostname.replace(/^www\./, '')
}
const error = ref('')
const pictureError=ref(false)
watch(()=>[form.image_url,form.image_mode],()=>{pictureError.value=false})
watch(()=>form.image_mode,mode=>{if(mode!=='custom'){form.image_url='';form.image_source_url=null}})
function addOffer() { form.offers.push({ retailer: '', url: '', price: '', seller_type: 'retailer', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' }) }
function submit() {
  const result = productSchema.safeParse({ ...form, image_url:form.image_mode==='none'?null:form.image_url||null,image_source_url:form.image_mode==='auto'?form.image_source_url:null, msrp_cents: form.msrp ? Math.round(Number(form.msrp) * 100) : null,
    msrp_source_url: form.msrp_source_url || null,
    offers: form.offers.map(o => ({ ...o, price_cents: Math.round(Number(o.price) * 100) })) })
  if (!result.success) { error.value = result.error.issues[0]?.message || 'Please check the form.'; return }
  emit('save', result.data)
}
</script>
<template>
  <form class="form-stack" @submit.prevent="submit">
    <p class="muted">Save something from any store. Add a price now, or leave it for a later check.</p>
    <label>Product name<input v-model="form.name" required maxlength="200" placeholder="e.g. Razer DeathAdder V3" /></label>
    <div class="form-row"><label>Exact variant<input v-model="form.variant" maxlength="200" placeholder="Size, color, model…" /></label><label>Category<select v-model="form.category"><option>Tech</option><option>Home</option><option>Style</option><option>Books</option><option>Outdoors</option><option>Other</option></select></label></div>
    <fieldset class="picture-editor form-stack"><legend>Product picture</legend><label>Picture style<select v-model="form.image_mode"><option value="auto">Find automatically</option><option value="custom">Use an image link</option><option value="none">Use category artwork</option></select></label><label v-if="form.image_mode==='custom'">Picture URL<input v-model="form.image_url" type="url" required maxlength="2048" placeholder="https://…/product.jpg" /></label><p v-else-if="form.image_mode==='auto'" class="field-note">We’ll look for a picture on the product’s listing pages. The category artwork stays if one isn’t available.</p><button v-if="form.image_mode==='auto'&&form.image_url" type="button" class="text-button" @click="form.image_url='';form.image_source_url=null">Find a picture again when saved</button><div class="editor-product-picture"><ProductPicture :product="{name:form.name,variant:form.variant,category:form.category,image_url:form.image_url,image_mode:form.image_mode}" eager @error="pictureError=true" /></div><p v-if="pictureError" class="field-note">This picture couldn’t load. Try another image link or keep the category artwork.</p></fieldset>
    <div class="form-row"><label>MSRP in USD <span class="optional">optional</span><input v-model="form.msrp" type="number" min="0.01" step="0.01" max="1000000" placeholder="69.99" /></label><label>Manufacturer MSRP source<input v-model="form.msrp_source_url" type="url" :required="!!form.msrp" placeholder="https://manufacturer.com/product" /></label></div>
    <p class="field-note">Use the manufacturer’s MSRP. A store’s crossed-out price may be different.</p>
    <div class="section-label"><span>STORE OFFERS</span><button v-if="form.offers.length < 10" type="button" class="text-button" @click="addOffer"><WishIcon name="plus" :size="15" /> Add a store</button></div>
    <div v-for="(offer, index) in form.offers" :key="index" class="offer-form">
      <div class="form-row"><label>Store<input v-model="offer.retailer" required maxlength="100" placeholder="Retailer or seller name" /></label><label>Price in USD<input v-model="offer.price" type="number" required min="0.01" max="1000000" step="0.01" placeholder="49.99" /></label></div>
      <label>Product URL<input v-model="offer.url" type="url" required placeholder="https://…" /></label>
      <div class="form-row"><label>Seller type<select v-model="offer.seller_type"><option value="manufacturer">Manufacturer</option><option value="retailer">Retailer</option><option value="marketplace">Third-party seller</option></select></label><label>US shipping<select v-model="offer.us_shipping"><option value="unknown">Not verified</option><option value="confirmed">Confirmed</option></select></label></div>
      <div class="form-row"><label>Availability<select v-model="offer.availability"><option value="unknown">Not verified</option><option value="in_stock">In stock</option></select></label><label>Shipping / offer details<input v-model="offer.shipping_note" maxlength="500" placeholder="Shipping cost, coupon, membership…" /></label></div>
      <button type="button" class="text-button danger" @click="form.offers.splice(index, 1)">Remove store</button>
    </div>
    <label>A note for your people<textarea v-model="form.notes" maxlength="2000" rows="2" placeholder="The little details that help them get it right." /></label>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button class="primary-button full" :disabled="busy">{{ busy ? 'Saving…' : item ? 'Save changes' : 'Add to wishlist' }}<WishIcon name="arrow" :size="17" /></button>
  </form>
</template>
