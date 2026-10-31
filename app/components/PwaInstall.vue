<script setup lang="ts">
const open = ref(false)
const ready = useState('pwa-ready', () => false)
const deferred = shallowRef<Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }>()
function available(event: Event) { event.preventDefault(); deferred.value = event as typeof deferred.value }
onMounted(() => window.addEventListener('beforeinstallprompt', available))
onBeforeUnmount(() => window.removeEventListener('beforeinstallprompt', available))
async function install() {
  if (!deferred.value) { open.value = true; return }
  await deferred.value.prompt(); await deferred.value.userChoice; deferred.value = undefined
}
</script>
<template>
  <button type="button" class="new-list-button" @click="install"><WishIcon name="box" :size="17" />Install Ósk</button>
  <WishModal v-if="open" title="Your wishes, close at hand." @close="open = false"><div class="form-stack"><p class="muted">On iPhone or iPad, open Ósk in Safari, choose Share, then Add to Home Screen. On Android or desktop, open the browser menu and choose Install app or Add to Home Screen.</p><p class="note-box">{{ ready ? 'This device has the app ready for offline use.' : 'Open the deployed app online first and let it finish loading to prepare offline access.' }} Your saved lists and new additions stay on this device until you reconnect. Sync runs while Ósk is open or when you open it again online.</p><button class="primary-button" @click="open = false">Got it</button></div></WishModal>
</template>
