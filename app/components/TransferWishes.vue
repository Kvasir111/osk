<script setup lang="ts">
import type { WishList } from '../../shared/types'
const props = defineProps<{ids:string[];mode:'move'|'copy';lists:WishList[];busy?:boolean}>()
const emit = defineEmits<{save:[entries:{id:string;copy_id:string}[],target:string,mode:'move'|'copy']}>()
const store=useWishlists()
// These IDs survive a failed response. Retrying a copy cannot create duplicates.
const entries=props.ids.map(id=>({id,copy_id:crypto.randomUUID()}))
const choices=computed(()=>props.lists.filter(list=>!props.ids.every(id=>store.items.value.find(i=>i.id===id)?.list_id===list.id)))
const target=ref(choices.value[0]?.id||'')
</script>
<template>
  <form class="form-stack" @submit.prevent="emit('save',entries,target,mode)"><p class="muted">{{ ids.length }} {{ ids.length===1?'wish':'wishes' }} selected. {{ mode==='move'?'Price history stays with each wish. Anyone with access to the destination can then see it.':'Copies keep the details and saved offers. Their prices start as manual entries until checked again.' }}</p><label>Destination list<select v-model="target" required :disabled="busy"><option v-for="list in choices" :key="list.id" :value="list.id">{{ list.name }}</option></select></label><p v-if="!choices.length" class="note-box">Create another list you can edit first.</p><p class="field-note">Sync and reconnect before moving or copying saved wishes.</p><button class="primary-button" :disabled="busy || !target">{{ busy?'Saving…':mode==='move'?'Move wishes':'Copy wishes' }}</button></form>
</template>
