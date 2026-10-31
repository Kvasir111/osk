<script setup lang="ts">
import type { WishItem } from '../../shared/types'
import { artworkFor } from '../../shared/product-images'
import { retailerCount } from '../../shared/retailers'
import { bestOffer, money, savings } from '../../shared/pricing'
const props = defineProps<{ item: WishItem; editable?: boolean; demo?: boolean; refreshing?: boolean }>()
defineEmits<{ open: [item: WishItem]; refresh: [id: string] }>()
const best = computed(() => bestOffer(props.item.offers))
const discount = computed(() => savings(props.item))
const artwork = computed(() => artworkFor(props.item.name))
const checked = computed(() => props.item.checked_at ? new Date(props.item.checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null)
</script>
<template>
  <article class="product-card">
    <button class="product-art" :class="artwork" :aria-label="`View ${item.name}`" @click="$emit('open', item)">
      <span v-if="discount" class="sale-tag"><WishIcon name="trend" :size="13" /> {{ discount.percent }}% below MSRP</span>
      <span v-else class="category-tag">{{ item.category || 'On the wishlist' }}</span>
      <ProductPicture :product="item" />
      <span class="art-heart"><WishIcon name="heart" :size="17" /></span>
    </button>
    <div class="product-info">
      <p class="product-retailer">{{ best?.retailer || 'A future favorite' }} <span v-if="item.offers.length > 1">+ {{ item.offers.length - 1 }} more</span></p>
      <button class="product-title" @click="$emit('open', item)">{{ item.name }}</button>
      <p class="product-variant">{{ item.variant || 'Details make the difference.' }}</p>
      <div class="price-row"><strong>{{ best ? money(best.price_cents) : 'Price unknown' }}</strong><span v-if="discount" class="old-price">{{ money(item.msrp_cents!) }}</span><span v-if="discount" class="saved-price">Save {{ money(discount.cents) }}</span></div>
      <p v-if="!demo" class="coverage-caption">{{ retailerCount(item) }} priced retailers · {{ retailerCount(item) < 2 ? 'incomplete comparison' : 'comparison target met' }}</p>
      <div class="card-bottom"><span :class="{ 'text-amber-700': item.refresh_status === 'failed' }"><WishIcon :name="item.refresh_status === 'failed' ? 'clock' : 'refresh'" :size="12" />{{ demo ? 'Sample prices' : item.refresh_status === 'failed' ? 'Refresh failed · previous price' : checked ? `Checked ${checked}` : 'Not checked yet' }}</span>
        <button v-if="editable && !demo" class="icon-button small" :disabled="refreshing" :aria-label="`Refresh price for ${item.name}`" @click="$emit('refresh', item.id)"><WishIcon name="refresh" :size="14" :class="{ spinning: refreshing }" /></button>
        <WishIcon v-else name="arrow" :size="15" />
      </div>
    </div>
  </article>
</template>
