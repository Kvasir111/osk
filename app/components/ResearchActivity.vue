<script setup lang="ts">
const { user,demo }=useAccount()
const { jobs,resume,fetchJob }=useSearchJobs()
const store=useWishlists()
const dismissed=ref<string[]>([])
const networkError=ref(false)
let timer:ReturnType<typeof setTimeout>|undefined
let generation=0
const pending=computed(()=>Object.values(jobs.value).filter(job=>['queued','running'].includes(job.status)))
const visible=computed(()=>pending.value[0]||Object.values(jobs.value).filter(job=>!dismissed.value.includes(job.id)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))[0])
async function tick(current:number){
  if(current!==generation)return
  let changed=false
  try{
    for(const job of pending.value){
      if(current!==generation)return
      const updated=await fetchJob(job.id)
      if(['completed','failed'].includes(updated.status)&&updated.approved_item_id)changed=true
    }
    networkError.value=false
    if(changed&&current===generation&&store.loaded.value)await store.load()
  }catch{networkError.value=true}
  if(current===generation)timer=setTimeout(()=>tick(current),2000)
}
watch(()=>user.value?.id,async id=>{
  generation++;const current=generation;clearTimeout(timer);jobs.value={};dismissed.value=[]
  if(demo||!id)return
  try{await resume()}catch{networkError.value=true}
  if(current===generation)timer=setTimeout(()=>tick(current),1000)
},{immediate:true})
onBeforeUnmount(()=>{generation++;clearTimeout(timer)})
</script>
<template><aside v-if="visible&&!demo" class="research-activity" aria-label="Product research"><div><strong>{{ ['queued','running'].includes(visible.status)?'Comparing prices…':visible.status==='failed'?'Some checks could not finish':'Price checks finished' }}</strong><p>{{ visible.result?.products[0]?.name||'Your product' }}{{ pending.length>1?` · ${pending.length} searches running`:'' }}</p><p v-if="networkError" class="field-note">Reconnecting to search progress…</p><NuxtLink :to="{path:'/capture',query:{search:visible.id}}">{{ visible.approved_item_id?'View comparison':'Review & save' }} →</NuxtLink></div><button v-if="!['queued','running'].includes(visible.status)" class="icon-button" aria-label="Dismiss research notification" @click="dismissed.push(visible.id)"><WishIcon name="close" :size="16" /></button></aside></template>
