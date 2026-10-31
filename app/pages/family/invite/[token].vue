<script setup lang="ts">
const { user, api, demo } = useAccount()
const route = useRoute()
const busy = ref(false)
const error = ref('')
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] })
async function join() {
  busy.value = true; error.value = ''
  try {
    const result = await api<{ family_id: string }>(`/api/family-join/${encodeURIComponent(String(route.params.token))}`, { method: 'POST' })
    await navigateTo({ path: '/family', query: { id: result.family_id } })
  } catch (e: any) { error.value = e.data?.statusMessage || 'This family invitation is unavailable.' }
  finally { busy.value = false }
}
</script>
<template><main class="auth-page"><OskBrand /><section class="auth-card"><span class="eyebrow">A PLACE WITH YOUR PEOPLE</span><h1>You’re invited.</h1><p>Join a private family hub to see the wishlists its members choose to share. Your own lists stay private until you share them.</p><p v-if="demo" class="note-box">Accounts haven’t been connected here yet.</p><button v-else-if="user" class="primary-button full" :disabled="busy" @click="join">{{ busy ? 'Joining…' : 'Accept family invitation' }}</button><NuxtLink v-else class="primary-button full" :to="{ path: '/login', query: { next: route.path } }">Sign in to accept</NuxtLink><p v-if="error" class="error-message" role="alert">{{ error }}</p><p class="field-note">Invitations expire after 7 days and require an approved account.</p></section></main></template>
