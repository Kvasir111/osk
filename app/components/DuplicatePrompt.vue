<script setup lang="ts">
const { request, choose } = useDuplicatePrompt()
const store = useWishlists()
const { user, demo } = useAccount()
const matches = computed(() => store.items.value.filter(i => request.value?.ids.includes(i.id)))
watch(user, () => choose('cancel'))
const route=useRoute()
watch(()=>route.fullPath,()=>choose('cancel'))
</script>
<template>
  <WishModal v-if="request" title="Already among your wishes?" @close="choose('cancel')">
    <div class="form-stack"><p class="muted">These wishes have the same product link or name and variant. Choose one to reuse, or save a separate wish.</p>
      <div v-for="item in matches" :key="item.id" class="note-box form-stack"><strong>{{ item.name }}</strong><span>{{ item.variant }} · {{ store.lists.value.find(l => l.id === item.list_id)?.name }}{{ item.status && item.status !== 'active' ? ` · ${item.status}` : '' }}</span>
        <button class="secondary-button" :disabled="item.list_id !== request.target && (!demo && (!store.online.value || item.pending_sync))" @click="choose(item.id)">{{ item.list_id === request.target ? 'Keep existing wish' : 'Copy existing wish to this list' }}</button>
      </div>
      <p class="field-note">Copying keeps the saved details and makes a separate wish. Sync and reconnect before copying between lists.</p>
      <button class="primary-button" @click="choose('new')">Add as a separate wish</button><button class="text-button" @click="choose('cancel')">Back to my draft</button>
    </div>
  </WishModal>
</template>
