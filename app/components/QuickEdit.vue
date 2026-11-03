<script setup lang="ts">
import type { ProductDraft, WishItem } from '../../shared/types'
import { productSchema } from '../../shared/validation'
const props = defineProps<{item:WishItem;busy?:boolean}>()
const emit = defineEmits<{save:[product:ProductDraft]}>()
const form = reactive({variant:props.item.variant,notes:props.item.notes,priority:props.item.priority||'idea',gift_preferences:props.item.gift_preferences||'',prices:props.item.offers.map(o=>String(o.price_cents/100))})
const error = ref('')
function save() {
  const result = productSchema.safeParse({...props.item,...form,offers:props.item.offers.map((offer,i)=>({...offer,price_cents:Math.round(Number(form.prices[i])*100)}))})
  if (!result.success) {error.value=result.error.issues[0]?.message||'Check the price.';return}
  emit('save',result.data)
}
</script>
<template>
  <form class="form-stack" @submit.prevent="save"><label>Exact variant<input v-model="form.variant" maxlength="200" placeholder="Size, color, model…" /></label>
    <label v-for="(offer,i) in item.offers" :key="i">{{ offer.retailer }} price in USD<input v-model="form.prices[i]" type="number" required min="0.01" max="1000000" step="0.01" /></label>
    <p v-if="!item.offers.length" class="field-note">Use Edit item to add a product link and its first price.</p>
    <WishPreferences v-model:priority="form.priority" v-model:preferences="form.gift_preferences" />
    <label>A note for your people<textarea v-model="form.notes" rows="3" maxlength="2000" /></label><p class="field-note">A changed price or variant becomes a manual entry until the next successful check.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><button class="primary-button" :disabled="busy">{{ busy?'Saving…':'Save quick changes' }}</button>
  </form>
</template>
