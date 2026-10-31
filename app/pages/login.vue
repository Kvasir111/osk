<script setup lang="ts">
const { user, client, demo } = useAccount()
const route = useRoute()
const email = ref('')
const busy = ref(false)
const sent = ref(false)
const error = ref('')
const next = computed(() => typeof route.query.next === 'string' && /^(?:\/profile|\/invitations|\/invite\/[a-f0-9-]{36}|\/family(?:\/invite\/[a-f0-9-]{36})?|\/capture(?:\?.*)?)$/.test(route.query.next) ? route.query.next : '/')
watch(user, value => { if (value) navigateTo(next.value) }, { immediate: true })
async function signIn() {
  if (!client) return
  busy.value = true; error.value = ''
  try {
    const redirect = new URL('/login', location.origin)
    if (next.value !== '/') redirect.searchParams.set('next', next.value)
    const { error: authError } = await client.auth.signInWithOtp({ email: email.value,
      options: { shouldCreateUser: false, emailRedirectTo: redirect.href } })
    if (authError) throw authError
    sent.value = true
  } catch { error.value = 'Could not send a sign-in link. Check your email, account invitation, or try again in a minute.' }
  finally { busy.value = false }
}
</script>
<template><main class="auth-page"><OskBrand /><section class="auth-card"><span class="eyebrow">A FEW GOOD WISHES</span><h1>Your wishes.<br /><em>Thoughtfully kept.</em></h1><p>A place to keep the things you love, and share a few hints with the people who love you.</p><div v-if="demo" class="form-stack"><div class="note-box">You’re viewing the local demo. Lists you create are saved in this browser. Accounts, sharing, live product search, and daily price checks become available after setup.</div><NuxtLink class="primary-button full" to="/">Explore the demo<WishIcon name="arrow" :size="17" /></NuxtLink></div><form v-else class="form-stack" @submit.prevent="signIn"><label>Your email<input v-model="email" type="email" autocomplete="email" required placeholder="you@example.com" /></label><button class="primary-button full" :disabled="busy">{{ busy ? 'Sending…' : 'Email me a sign-in link' }}<WishIcon name="arrow" :size="17" /></button><p class="field-note">For invited friends and family. Use the email your account invitation was sent to.</p><p v-if="sent" class="success-message" role="status">If this email has an account, a sign-in link is on its way. Check your inbox.</p><p v-if="error" class="error-message" role="alert">{{ error }}</p></form><NuxtLink to="/join" class="feature-back">Have an invitation code? Join Ósk →</NuxtLink></section><p class="auth-footer">A little space for what matters.</p></main></template>
