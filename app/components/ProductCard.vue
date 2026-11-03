<script setup lang="ts">
import type { WishItem } from '../../shared/types'
import { artworkFor } from '../../shared/product-images'
import { retailerCount } from '../../shared/retailers'
import { bestOffer, money, savings } from '../../shared/pricing'
const online = useState('offline-online', () => true)
const props = defineProps<{ item: WishItem; editable?: boolean; demo?: boolean; refreshing?: boolean; selectable?:boolean; selected?:boolean; listName?:string }>()
defineEmits<{ open: [item: WishItem]; refresh: [id: string]; quick:[item:WishItem]; select:[id:string] }>()
const best = computed(() => bestOffer(props.item.offers))
const discount = computed(() => savings(props.item))
const artwork = computed(() => artworkFor(props.item.name))
const checked = computed(() => props.item.checked_at ? new Date(props.item.checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null)
</script>
<template>
  <article class="product-card">
    <label v-if="selectable" class="wish-selection"><input type="checkbox" :checked="selected" :aria-label="`Select ${item.name}`" @change="$emit('select',item.id)" />Select wish</label>
    <button class="product-art" :class="artwork" :aria-label="`View ${item.name}`" @click="$emit('open', item)">
      <span v-if="discount" class="sale-tag"><WishIcon name="trend" :size="13" /> {{ discount.percent }}% below MSRP</span>
      <span v-else class="category-tag">{{ item.category || 'On the wishlist' }}</span>
      <ProductPicture :product="item" />
      <span class="art-heart"><WishIcon name="heart" :size="17" /></span>
    </button>
    <div class="product-info">
      <p v-if="listName" class="wish-list-caption">{{ listName }}</p>
      <div v-if="item.priority==='really_want' || (item.status && item.status!=='active')" class="wish-badges"><span v-if="item.priority==='really_want'" class="mini-badge">Really want</span><span v-if="item.status && item.status!=='active'" class="mini-badge">{{ item.status==='received'?'Received':'Archived' }}</span></div>
      <p class="product-retailer">{{ best?.retailer || 'A future favorite' }} <span v-if="item.offers.length > 1">+ {{ item.offers.length - 1 }} more</span></p>
      <button class="product-title" @click="$emit('open', item)">{{ item.name }}</button>
      <p class="product-variant">{{ item.variant || 'Details make the difference.' }}</p>
      <div class="price-row"><strong>{{ best ? money(best.price_cents) : 'Price unknown' }}</strong><span v-if="discount" class="old-price">{{ money(item.msrp_cents!) }}</span><span v-if="discount" class="saved-price">Save {{ money(discount.cents) }}</span></div>
      <p v-if="item.pending_sync" class="coverage-caption">Saved on this device · waiting to sync</p>
      <p v-else-if="!demo" class="coverage-caption">{{ retailerCount(item) }} priced retailers · {{ retailerCount(item) < 2 ? 'incomplete comparison' : 'comparison target met' }}</p>
      <button v-if="editable" class="text-button" :disabled="!demo && (!online || item.pending_sync)" :aria-label="`Quick edit ${item.name}`" @click="$emit('quick',item)">Quick edit</button>
      <div class="card-bottom"><span :class="{ 'text-amber-700': item.refresh_status === 'failed' }"><WishIcon :name="item.refresh_status === 'failed' ? 'clock' : 'refresh'" :size="12" />{{ demo ? 'Sample prices' : item.refresh_status === 'failed' ? 'Refresh failed · previous price' : checked ? `Checked ${checked}` : 'Not checked yet' }}</span>
        <button v-if="editable && !demo && (!item.status || item.status==='active')" class="icon-button small" :disabled="refreshing || item.pending_sync || !online" :aria-label="`Refresh price for ${item.name}`" @click="$emit('refresh', item.id)"><WishIcon name="refresh" :size="14" :class="{ spinning: refreshing }" /></button>
        <WishIcon v-else name="arrow" :size="15" />
      </div>
    </div>
  </article>
</template>
