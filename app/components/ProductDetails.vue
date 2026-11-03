<script setup lang="ts">
import type { WishItem } from '../../shared/types'
import { money, savings } from '../../shared/pricing'
import { retailerCount } from '../../shared/retailers'
const props = defineProps<{ item: WishItem; editable?: boolean; demo?: boolean; shareToken?: string }>()
defineEmits<{ edit: []; remove: [] }>()
const sorted = computed(() => [...props.item.offers].sort((a, b) => a.price_cents - b.price_cents))
const discount = computed(() => savings(props.item))
const deleting = ref(false)
</script>
<template>
  <div class="form-stack">
    <div class="detail-product-picture"><ProductPicture :product="item" eager /></div>
    <a v-if="item.image_url && item.image_source_url && item.image_mode !== 'none'" class="field-note picture-source" :href="item.image_source_url" target="_blank" rel="noopener noreferrer">Picture from product listing ↗</a>
    <div><span class="eyebrow">{{ item.category }}</span><p class="detail-variant">{{ item.variant }}</p><p v-if="item.notes" class="note-box">{{ item.notes }}</p></div>
    <div v-if="item.msrp_cents" class="baseline-box"><span>Manufacturer MSRP</span><a v-if="item.msrp_source_url" :href="item.msrp_source_url" target="_blank" rel="noopener noreferrer">{{ money(item.msrp_cents) }} <WishIcon name="external" :size="13" /></a><strong v-else>{{ money(item.msrp_cents) }}</strong></div>
    <p v-else class="muted">MSRP hasn’t been verified for this item yet.</p>
    <p v-if="item.checked_at && !demo && retailerCount(item) < 2" class="coverage-warning">Incomplete retailer comparison: {{ retailerCount(item) }} of 2 stores beyond the manufacturer have a verified price for this variant.</p>
    <p v-if="discount" class="savings-note">A little patience pays off. {{ money(discount.cents) }} below MSRP.</p>
    <PriceHistory :item="item" :demo="demo" :share-token="shareToken" />
    <PriceCheckStatus :item="item" :demo="demo" />
    <p v-if="editable && !demo && item.refresh_status === 'failed'" class="note-box">Use Edit item to correct the product name, exact variant, or store links shown above. If a store blocks automated checks, keep its price manual or add a link from another store.</p>
    <div class="section-label"><span>{{ sorted.length }} STORE {{ sorted.length === 1 ? 'OFFER' : 'OFFERS' }}</span><span>USD · BEFORE TAX & SHIPPING</span></div>
    <p v-if="!sorted.length" class="empty-inline">No prices yet. Add a store or check again later.</p>
    <a v-for="(offer, index) in sorted" :key="offer.url + index" :href="offer.url" target="_blank" rel="noopener noreferrer" class="store-offer">
      <div><div class="store-name">{{ offer.retailer }} <span v-if="index === 0" class="mini-badge">Lowest listed</span></div><p>{{ offer.seller_type === 'marketplace' ? 'Third-party seller' : offer.seller_type === 'manufacturer' ? 'Manufacturer store' : 'Retailer' }} · {{ offer.us_shipping === 'confirmed' ? 'US shipping reported' : 'US shipping not verified' }}</p><p>{{ offer.availability === 'in_stock' ? 'In stock when checked' : 'Availability not verified' }}</p><p v-if="offer.shipping_note">{{ offer.shipping_note }}</p></div>
      <div class="offer-price"><strong>{{ money(offer.price_cents) }}</strong><WishIcon name="external" :size="15" /></div>
    </a>
    <p class="field-note">{{ demo ? 'These are sample offers, not live prices.' : item.checked_at ? `Recorded prices checked ${new Date(item.checked_at).toLocaleString('en-US')}. Confirm the exact model, seller, eligibility, and final price at checkout.` : 'Manually entered prices. Confirm the exact model and final price at checkout.' }}</p>
    <p v-if="item.refresh_status === 'failed'" class="error-message">The latest price check failed. The previous offers are shown above.</p>
    <div v-if="editable" class="modal-actions"><button class="secondary-button" @click="$emit('edit')"><WishIcon name="edit" :size="16" />Edit item</button><button class="text-button danger" @click="deleting ? $emit('remove') : deleting = true">{{ deleting ? 'Confirm removal' : 'Remove item' }}</button></div>
  </div>
</template>
