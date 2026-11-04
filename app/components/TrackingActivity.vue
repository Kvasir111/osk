<script setup lang="ts">
const {user,demo}=useAccount()
const tracking=usePriceTracking()
let timer:ReturnType<typeof setTimeout>|undefined
let generation=0
async function refresh() {
  clearTimeout(timer)
  const current=++generation
  if(!demo && !user.value)return
  if(document.visibilityState!=='hidden') await tracking.load()
  if(current===generation && !demo) timer=setTimeout(refresh,60000)
}
watch(()=>user.value?.id,()=>{tracking.reset(demo?'demo':user.value?.id||'');void refresh()},{immediate:true,flush:'sync'})
function visible() {if(document.visibilityState==='visible')void refresh()}
onMounted(()=>{window.addEventListener('online',refresh);document.addEventListener('visibilitychange',visible)})
onBeforeUnmount(()=>{generation++;clearTimeout(timer);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',visible)})
</script>
<template><NuxtLink v-if="tracking.unread.value>0 && (demo || user)" to="/tracking?tab=alerts" class="price-alert-pill" aria-label="Open price alerts"><WishIcon name="trend" :size="17" />{{ tracking.unread.value }} {{ tracking.unread.value===1?'price alert':'price alerts' }}</NuxtLink></template>
