<script setup lang="ts">
const available = useState('pwa-update-available', () => false)
const busy = useState('pwa-updating', () => false)
const error = useState('pwa-update-error', () => '')
const dismissed = ref(false)
const { $pwaUpdates } = useNuxtApp()
const store = useWishlists()
</script>
<template>
  <aside v-if="available" class="app-update" aria-label="App update">
    <template v-if="!dismissed">
      <div><p role="status"><strong>An Ósk update is available</strong></p><p class="field-note">Finish any open forms before reloading. Wishes saved on this device will stay, including additions waiting to sync.</p><p v-if="error" class="error-message" role="alert">{{ error }}</p></div>
      <div class="app-update-actions"><button class="primary-button" :disabled="busy || store.syncing.value" @click="$pwaUpdates.apply()">{{ busy ? 'Updating…' : store.syncing.value ? 'Waiting for sync…' : 'Update & reload' }}</button><button class="text-button" :disabled="busy" @click="dismissed = true">Later</button></div>
    </template>
    <button v-else class="text-button" @click="dismissed = false">App update available</button>
  </aside>
</template>
