<script setup lang="ts">
import type { PriceObservation, WishItem } from '../../shared/types'
import { priceHistory } from '../../shared/history'
import { money, bestOffer } from '../../shared/pricing'
import { retailerDomain } from '../../shared/retailers'
const props = defineProps<{ item: WishItem; demo?: boolean; shareToken?: string }>()
const { api } = useAccount()
const history = ref<PriceObservation[]>([])
const loading = ref(true)
const error = ref('')
const store = ref('all')
let request = 0
async function load() {
  const current = ++request
  loading.value = true; error.value = ''
  try {
    const rows = props.demo ? [] : props.shareToken
      ? await $fetch<PriceObservation[]>(`/api/share/${props.shareToken}/history/${props.item.id}`)
      : await api<PriceObservation[]>(`/api/items/${props.item.id}/history`)
    if (current === request) history.value = rows
  } catch { if (current === request) error.value = 'Price history could not load. Please try again.' }
  finally { if (current === request) loading.value = false }
}
watch(() => [props.item.id, props.item.checked_at, props.item.name, props.item.variant], () => { store.value = 'all'; load() }, { immediate: true })
const context = computed(() => priceHistory(history.value, props.item))
const stores = computed(() => [...new Set(context.value.points.flatMap(h => h.offers.map(o => retailerDomain(o.url))))])
const points = computed(() => context.value.points.flatMap(h => {
  const offer = bestOffer(h.offers.filter(o => store.value === 'all' || retailerDomain(o.url) === store.value))
  return offer ? [{ date: h.observed_at, price: offer.price_cents, retailer: offer.retailer }] : []
}))
const chart = computed(() => {
  if (!points.value.length) return null
  const values = points.value.map(p => p.price)
  const min = Math.min(...values), max = Math.max(...values)
  const padding = Math.max((max - min) * .15, max * .03, 100)
  const low = Math.max(0, min - padding), high = max + padding
  const first = new Date(points.value[0]!.date).getTime(), last = new Date(points.value.at(-1)!.date).getTime()
  const mapped = points.value.map(p => ({ ...p, x: last === first ? 330 : 65 + (new Date(p.date).getTime() - first) / (last - first) * 555,
    y: 150 - (p.price - low) / (high - low) * 130 }))
  return { mapped, path: mapped.map(p => `${p.x},${p.y}`).join(' '), low, high, min, max }
})
const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
</script>
<template>
  <section class="history-section" aria-label="Price history">
    <div class="section-label"><span>PRICE HISTORY & SALE CONTEXT</span></div>
    <p v-if="loading" class="field-note" role="status">Loading price history…</p>
    <div v-else-if="error" class="error-message" role="alert">{{ error }} <button class="text-button" @click="load">Retry</button></div>
    <template v-else>
      <p v-if="demo" class="note-box">History starts when live price checks run. Sample prices aren’t historical observations.</p>
      <template v-else>
        <div class="history-stats"><div><span>Lowest observed</span><strong>{{ context.lowest === null ? 'Not yet known' : money(context.lowest) }}</strong></div><div><span>Typical best price · prior 30 days</span><strong>{{ context.typical === null ? 'Building history' : money(context.typical) }}</strong></div></div>
        <p v-if="context.belowTypical" class="savings-note">Latest saved price is {{ money(context.belowTypical) }} below the typical best price we’ve observed.</p>
        <p v-if="context.isLowest" class="savings-note">The latest saved price matches or beats the lowest price in this history.</p>
        <p v-if="context.typical === null" class="field-note">We need checks on at least 3 prior days before estimating a typical price. MSRP remains a separate manufacturer baseline.</p>
        <template v-if="chart">
          <label class="history-store">Chart prices<select v-model="store"><option value="all">Best available across stores</option><option v-for="domain in stores" :key="domain" :value="domain">{{ domain }}</option></select></label>
          <p class="field-note">Observed range: {{ money(chart.min) }}–{{ money(chart.max) }}</p>
          <svg viewBox="0 0 650 180" class="history-chart" role="img" :aria-label="`Observed USD prices for ${item.name}, ${points.length} checks`">
            <line x1="65" y1="20" x2="620" y2="20" class="chart-grid" /><line x1="65" y1="150" x2="620" y2="150" class="chart-grid" />
            <polyline :points="chart.path" class="chart-line" />
            <circle v-for="(point, index) in chart.mapped" :key="index" :cx="point.x" :cy="point.y" r="4" class="chart-point"><title>{{ date(point.date) }} · {{ point.retailer }} · {{ money(point.price) }}</title></circle>
          </svg>
          <div class="chart-dates"><span>{{ date(points[0]!.date) }}</span><span>{{ date(points.at(-1)!.date) }}</span></div>
        </template>
        <p v-else class="field-note">No automated price checks recorded for this exact variant yet. Your first successful check will start its history.</p>
        <p class="field-note">Up to the last year and 2,000 checks. “Typical” is the median of each prior day’s lowest observed price over 30 days. Manual entries are excluded. Changing the product name or variant starts a separate comparison. Prices exclude tax and shipping; store coverage can change.</p>
        <details v-if="history.length" class="history-records"><summary>Price records ({{ history.length }})</summary><div class="table-scroll"><table><caption class="sr-only">Recorded prices by store</caption><thead><tr><th scope="col">When / source</th><th scope="col">Store</th><th scope="col">USD</th></tr></thead><tbody><template v-for="record in history" :key="record.id"><tr v-for="(offer, index) in record.offers" :key="record.id + index"><td>{{ date(record.observed_at) }}<small>{{ record.source === 'manual' ? 'Manual entry' : 'Automated price check' }}</small></td><td><a :href="offer.url" target="_blank" rel="noopener noreferrer">{{ offer.retailer }} ↗</a></td><td>{{ money(offer.price_cents) }}</td></tr></template></tbody></table></div></details>
      </template>
    </template>
  </section>
</template>
