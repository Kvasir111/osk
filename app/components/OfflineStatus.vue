<script setup lang="ts">
const store = useWishlists()
const { demo, user, client } = useAccount()
const error = ref('')
const blocked = computed(() => store.pending.value.filter(op => op.status === 'blocked').length)
async function retry() {
  await store.sync(true)
  try { await store.load() } catch { /* Keep the local copy on failure. */ }
}
async function signInAgain() {
  // Ending an expired session is separate from explicit sign-out: retain the outbox.
  user.value = null
  if (client) { client.auth.stopAutoRefresh(); await client.auth.signOut({ scope: 'local' }).catch(() => {}) }
  await navigateTo('/login')
}
async function discard(id: string) {
  if (!confirm('Remove this unsynced addition from this device? Removing a new list also removes its unsynced wishes.')) return
  error.value = ''
  try { await store.discardAddition(id) }
  catch (e: any) { error.value = e.message || 'The local addition could not be removed.' }
}
</script>
<template>
  <aside v-if="!store.online.value || (!demo && (store.pending.value.length || store.syncError.value || store.storageError.value))" class="offline-status" aria-label="Offline and sync status">
    <div class="offline-status-heading"><p role="status">{{ !store.online.value ? 'Offline · showing saved wishes' : store.storageError.value ? 'Offline storage needs attention' : store.syncing.value ? 'Syncing your additions…' : blocked ? 'Some additions need attention' : 'Additions saved on this device' }}<span v-if="store.pending.value.length"> · {{ store.pending.value.length }} waiting to sync</span></p><button v-if="!demo && !store.syncing.value" class="text-button" @click="retry">Retry sync</button></div>
    <p v-if="!store.online.value" class="field-note">Add wishes and new lists now. They’ll sync when you reopen or reconnect. Prices may be out of date.</p>
    <p v-if="store.syncError.value" class="field-note">{{ store.syncError.value }} <button v-if="store.syncError.value.startsWith('Sign in')" type="button" class="text-button" @click="signInAgain">Sign in again →</button></p>
    <p v-if="store.storageError.value" class="field-note">{{ store.storageError.value }}</p>
    <details v-if="store.pending.value.length"><summary>Review unsynced additions</summary><ul><li v-for="op in store.pending.value" :key="op.id"><div><strong>{{ op.product.name }}</strong><p class="field-note">{{ op.kind === 'list' ? 'New list' : 'New wish' }} · {{ op.error || 'Waiting for a connection' }}</p></div><button type="button" class="text-button danger" :disabled="store.syncing.value" :aria-label="`Remove local addition ${op.product.name}`" @click="discard(op.id)">Remove</button></li></ul></details>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
  </aside>
</template>
