<script setup lang="ts">
const props = defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
let previous: Element | null = null
onMounted(() => { previous = document.activeElement; dialog.value?.showModal() })
onBeforeUnmount(() => { if (previous instanceof HTMLElement) previous.focus() })
function outside(event: MouseEvent) { if (event.target === dialog.value) emit('close') }
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="wish-modal" :class="{ wide: props.wide }" aria-labelledby="modal-heading" @cancel.prevent="emit('close')" @click="outside">
    <div class="modal-heading"><h2 id="modal-heading">{{ title }}</h2><button class="icon-button" aria-label="Close dialog" @click="emit('close')"><WishIcon name="close" /></button></div>
    <slot />
  </dialog></Teleport>
</template>
