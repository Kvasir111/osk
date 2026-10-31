<script setup lang="ts">
import { avatarInitials } from '../../shared/profile'
const props = withDefaults(defineProps<{ name: string; src?: string | null; size?: number }>(), { src: null, size: 32 })
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>
<template><span class="avatar user-avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(11, size / 3)}px` }" role="img" :aria-label="`${name || 'Your'} profile picture`"><img v-if="src && !failed" :src="src" alt="" referrerpolicy="no-referrer" @error="failed = true" /><span v-else>{{ avatarInitials(name) }}</span></span></template>
