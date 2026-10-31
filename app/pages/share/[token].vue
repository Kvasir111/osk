<script setup lang="ts">
import type { WishItem, WishList } from '../../../shared/types'
const route = useRoute()
const list = ref<Pick<WishList, 'name' | 'description' | 'occasion'> | null>(null)
const items = ref<WishItem[]>([])
const selected = ref<WishItem>()
const error = ref('')
const loading = ref(true)
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] })
onMounted(async () => {
  try {
    const data = await $fetch<{ list: typeof list.value; items: WishItem[] }>(`/api/share/${encodeURIComponent(String(route.params.token))}`)
    list.value = data.list; items.value = data.items
  } catch { error.value = 'This list is unavailable. The owner may have turned off sharing or replaced the link.' }
  finally { loading.value = false }
})
</script>
<template><main class="shared-page"><OskBrand /><div v-if="loading" class="page-loading" role="status">Opening a few good wishes…</div><div v-else-if="error" class="empty-state"><WishIcon name="heart" :size="40" /><h1>A little out of reach.</h1><p>{{ error }}</p></div><template v-else-if="list"><header class="shared-header"><span class="eyebrow">A LITTLE INSPIRATION, SHARED WITH YOU</span><h1>{{ list.name }}</h1><p>{{ list.description }}</p><span class="mini-badge">View-only wishlist · {{ items.length }} wishes</span></header><div class="product-grid"><ProductCard v-for="item in items" :key="item.id" :item="item" @open="selected = $event" /></div><p v-if="!items.length" class="empty-inline">A few good wishes are still on their way. Check back soon.</p><footer class="page-footer"><span>Prices exclude tax & shipping. Confirm details at the retailer.</span><span>Less searching. More meaning.</span></footer></template><WishModal v-if="selected" :title="selected.name" wide @close="selected = undefined"><ProductDetails :item="selected" :share-token="String(route.params.token)" /></WishModal></main></template>
