<script setup lang="ts">
const { theme, toggleTheme } = useTheme()
</script>

<template>
  <button class="theme-toggle" type="button" aria-label="Dark mode" :aria-pressed="theme === 'dark'" @click="toggleTheme">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.3A8.5 8.5 0 0 1 10.7 3.5 8.5 8.5 0 1 0 20.5 13.3Z" /></svg>
    <span>Dark mode</span><span class="theme-switch" aria-hidden="true"><span /></span>
  </button>
</template>
