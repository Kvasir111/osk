<script setup lang="ts">
import type { ProductDraft } from '../../shared/types'
import { artworkFor,pictureUrl } from '../../shared/product-images'
const props=defineProps<{product:Pick<ProductDraft,'name'|'variant'|'category'|'image_url'|'image_mode'>;eager?:boolean}>()
const emit=defineEmits<{error:[]}>()
const loaded=ref(false),failed=ref(false)
const src=computed(()=>pictureUrl(props.product))
const artwork=computed(()=>artworkFor(props.product.name))
watch(src,()=>{loaded.value=false;failed.value=false})
function error(){loaded.value=false;failed.value=true;emit('error')}
</script>
<template><div class="product-picture" :class="[{ 'has-photo':loaded },artwork]">
  <img v-if="src&&!failed" :key="src" :class="{ready:loaded}" :src="src" :alt="`${product.name}${product.variant?` · ${product.variant}`:''}`" :loading="eager?'eager':'lazy'" decoding="async" referrerpolicy="no-referrer" width="480" height="360" class="product-photo" @load="loaded=true" @error="error" />
  <template v-if="!loaded"><span class="art-circle" aria-hidden="true"></span><WishIcon class="product-drawing" :name="artwork" :size="108" aria-hidden="true" /><span class="art-label" aria-hidden="true">{{ product.category||'GOOD FINDS' }}</span></template>
</div></template>
