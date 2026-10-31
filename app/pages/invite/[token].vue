<script setup lang="ts">
const { user, api, demo } = useAccount()
const route = useRoute()
const activeListId = useState('active-list', () => '')
const busy = ref(false)
const joined = ref(false)
const error = ref('')
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] })
async function join() {
  busy.value = true; error.value = ''
  try {
    const result = await api<{ list_id: string }>(`/api/join/${encodeURIComponent(String(route.params.token))}`, { method: 'POST' })
    activeListId.value = result.list_id
    joined.value = true
    await navigateTo('/')
  } catch (e: any) { error.value = e.data?.statusMessage || 'This invitation is unavailable.' }
  finally { busy.value = false }
}
</script>
<template><main class="auth-page"><OskBrand /><section class="auth-card"><span class="eyebrow">YOU’RE ON THE LIST</span><h1>A few wishes.<br /><em>Better together.</em></h1><p>You’ve been invited to a wishlist. Accept to add it to your collection.</p><p v-if="demo" class="note-box">Accounts haven’t been connected on this site yet.</p><button v-else-if="user" class="primary-button full" :disabled="busy || joined" @click="join">{{ busy ? 'Joining…' : 'Accept invitation' }}<WishIcon name="arrow" :size="18" /></button><NuxtLink v-else class="primary-button full" :to="{ path: '/login', query: { next: route.path } }">Sign in to accept<WishIcon name="arrow" :size="18" /></NuxtLink><p v-if="error" class="error-message" role="alert">{{ error }}</p><p class="field-note">Invitations expire after 7 days. You’ll need an approved friends-and-family account to sign in.</p></section></main></template>
