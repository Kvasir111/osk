<script setup lang="ts">
import type { ProductDraft, PriceCheckDetails } from '../../shared/types'
import { captureUrl } from '../../shared/capture'
const props = defineProps<{ initialQuery: string; saving?: boolean; resumeId?: string }>()
const emit = defineEmits<{ approve: [product: ProductDraft, checkedAt: string, details: PriceCheckDetails, searchId?: string]; manual: [url?: string, name?: string] }>()
const { api, demo, user } = useAccount()
const ready = ref(demo)
const agent = ref(false)
onMounted(async () => {
  const account = user.value?.id
  try {
    if (!demo) {
      const config = await api<{ ai_enabled: boolean }>('/api/research-config', { accountId: account, timeout: 5000 })
      if (account === user.value?.id) agent.value = config.ai_enabled === true
    }
  } catch { /* Default to free page lookup when configuration is unavailable. */ }
  finally { ready.value = true }
})
function manual() {
  const url = captureUrl(props.initialQuery)
  emit('manual', url || undefined, url ? undefined : props.initialQuery.trim().slice(0,200))
}
</script>
<template>
  <template v-if="!ready"><p role="status">Preparing product lookup…</p><button class="secondary-button" :disabled="saving" @click="manual">Enter details manually</button></template>
  <AgentProductSearch v-else-if="agent" v-bind="props" @approve="(...args) => emit('approve', ...args)" @manual="(...args) => emit('manual', ...args)" />
  <ScrapedProductSearch v-else v-bind="props" @approve="(...args) => emit('approve', ...args)" @manual="(...args) => emit('manual', ...args)" />
</template>
