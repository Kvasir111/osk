<script setup lang="ts">
import type { WishItem } from '../../shared/types'
import { retailerCount } from '../../shared/retailers'
const props = defineProps<{ item: WishItem; demo?: boolean }>()
const date = (value: string) => new Date(value).toLocaleString('en-US')
const stale = computed(() => props.item.checked_at && Date.now() - new Date(props.item.checked_at).getTime() > 36 * 3600000)
</script>
<template>
  <section class="check-status" aria-label="Price check status">
    <h3>Price check status</h3>
    <p v-if="demo" class="field-note">Sample prices · live checks haven’t started.</p>
    <template v-else>
      <p><strong>{{ item.refresh_status === 'failed' ? 'Latest check failed · previous offers kept' : !item.checked_at ? 'Not checked · manually entered prices' : stale ? 'Prices need a fresh check' : 'Prices checked' }}</strong></p>
      <dl><div><dt>Last successful check</dt><dd>{{ item.checked_at ? date(item.checked_at) : 'Not yet' }}</dd></div><div><dt>Last attempt</dt><dd>{{ item.last_attempt_at ? date(item.last_attempt_at) : 'Not yet' }}</dd></div><div><dt>Priced retailers beyond manufacturer</dt><dd>{{ retailerCount(item) }} / 2{{ retailerCount(item) < 2 ? ' · incomplete comparison' : ' · comparison target met' }}</dd></div></dl>
      <template v-if="item.refresh_status !== 'never'"><p v-for="warning in item.price_check_details?.warnings" :key="warning" class="field-note">{{ warning }}</p><div v-if="item.price_check_details?.retailer_checks?.length" class="retailer-checks"><h4>Checked without a verified price</h4><div v-for="(check, index) in item.price_check_details.retailer_checks" :key="index" class="retailer-check"><a v-if="check.url" :href="check.url" target="_blank" rel="noopener noreferrer">{{ check.retailer }} ↗</a><strong v-else>{{ check.retailer }}</strong><p>{{ check.note }}</p></div></div></template>
      <p class="field-note">A priced listing is evidence for that check, not a guarantee of today’s stock or checkout price. An unverified listing doesn’t mean the store doesn’t sell it.</p>
    </template>
  </section>
</template>
