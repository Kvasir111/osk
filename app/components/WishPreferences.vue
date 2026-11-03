<script setup lang="ts">
const priority = defineModel<string>('priority', {default:'idea'})
const preferences = defineModel<string>('preferences', {default:''})
</script>
<template>
  <div class="form-stack"><label>How much would you love it?<select v-model="priority"><option value="idea">Just an idea</option><option value="really_want">Really want</option></select></label><label>Gift preferences <span class="optional">optional</span><textarea v-model="preferences" maxlength="1000" rows="2" placeholder="Sizes, favorite colors, alternatives, or things to avoid…" /></label></div>
</template>
