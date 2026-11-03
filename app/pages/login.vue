<script setup lang="ts">
const { user, client, demo } = useAccount()
const route = useRoute()
const recovery = useState('account-password-recovery', () => false)
const callbackFailed = useState('account-auth-callback-failed', () => false)
const email = ref('')
const password = ref('')
const mode = ref<'password' | 'link' | 'reset'>('password')
const busy = ref(false)
const sent = ref(false)
const error = ref('')
const finished = ref(false)
const recovering = computed(() => recovery.value || route.query.mode === 'recovery')
const next = computed(() => typeof route.query.next === 'string' && /^(?:\/profile|\/invitations|\/invite\/[a-f0-9-]{36}|\/family(?:\/invite\/[a-f0-9-]{36})?|\/capture(?:\?.*)?)$/.test(route.query.next) ? route.query.next : '/')
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] })
onMounted(() => {
  const fragment = new URLSearchParams(route.hash.slice(1))
  if (['access_token', 'refresh_token', 'error'].some(key => fragment.has(key))) return navigateTo({ path: route.path, query: route.query, hash: '' }, { replace: true })
})
watch([user, recovering], ([value, resetting]) => { if (value && !resetting && mode.value !== 'reset') navigateTo(next.value) }, { immediate: true })
onBeforeUnmount(() => { password.value = ''; recovery.value = false })
function choose(value: 'password' | 'link' | 'reset') {
  mode.value = value; sent.value = false; error.value = ''; password.value = ''
}
async function restartRecovery() {
  choose('reset')
  recovery.value = false; callbackFailed.value = false
  await navigateTo({ path: '/login', query: { ...(next.value !== '/' ? { next: next.value } : {}) } }, { replace: true })
}
async function signIn() {
  if (!client || busy.value) return
  if (!navigator.onLine) { error.value = 'Reconnect to sign in or request an email.'; return }
  busy.value = true; error.value = ''; sent.value = false
  try {
    if (mode.value === 'password') {
      const { error: authError } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value })
      password.value = ''
      if (authError) { error.value = 'Could not sign in. Check your email and password, or use a sign-in link to set your first password.'; return }
      callbackFailed.value = false
      await navigateTo(next.value)
    } else {
      const redirect = new URL('/login', location.origin)
      if (next.value !== '/') redirect.searchParams.set('next', next.value)
      if (mode.value === 'reset') redirect.searchParams.set('mode', 'recovery')
      const { error: authError } = mode.value === 'reset'
        ? await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: redirect.href })
        : await client.auth.signInWithOtp({ email: email.value.trim(), options: { shouldCreateUser: false, emailRedirectTo: redirect.href } })
      if (authError) throw authError
      sent.value = true
    }
  } catch { error.value = mode.value === 'password' ? 'Could not sign in. Check your connection and try again.' : 'Could not send the email. Check your connection or try again in a minute.' }
  finally { busy.value = false }
}
</script>
<template>
  <main class="auth-page"><OskBrand /><section class="auth-card"><span class="eyebrow">A FEW GOOD WISHES</span><h1>Your wishes.<br /><em>Thoughtfully kept.</em></h1><p>A place to keep the things you love, and share a few hints with the people who love you.</p>
    <div v-if="demo" class="form-stack"><div class="note-box">You’re viewing the local demo. Lists you create are saved in this browser. Accounts, sharing, live product search, and daily price checks become available after setup.</div><NuxtLink class="primary-button full" to="/">Explore the demo<WishIcon name="arrow" :size="17" /></NuxtLink></div>
    <div v-else-if="recovering" class="form-stack">
      <h2>Set your password</h2>
      <template v-if="user && !callbackFailed">
        <AccountPassword v-if="!finished" @saved="finished = true" />
        <template v-else><p class="success-message" role="status">Your password has been saved.</p><NuxtLink class="primary-button full" :to="next" @click="recovery = false">Continue to Ósk</NuxtLink></template>
      </template>
      <template v-else><p class="error-message" role="alert">This password-reset link is expired, invalid, or unavailable offline. Reconnect and request a new link.</p><button type="button" class="secondary-button" @click="restartRecovery">Request another reset link</button></template>
    </div>
    <form v-else class="form-stack" @submit.prevent="signIn">
      <p v-if="callbackFailed" class="error-message" role="alert">That email link is expired or invalid. Request a new link or sign in with your password.</p>
      <h2 v-if="mode === 'reset'">Set or reset your password</h2>
      <label>Your email<input v-model="email" type="email" autocomplete="username" required maxlength="254" placeholder="you@example.com" :disabled="busy" /></label>
      <label v-if="mode === 'password'">Password<input v-model="password" type="password" autocomplete="current-password" required :disabled="busy" /></label>
      <button class="primary-button full" :disabled="busy">{{ busy ? (mode === 'password' ? 'Signing in…' : 'Sending…') : mode === 'password' ? 'Sign in' : mode === 'reset' ? 'Email me a password-reset link' : 'Email me a sign-in link' }}<WishIcon name="arrow" :size="17" /></button>
      <p class="field-note">For invited friends and family. Use the email your account invitation was sent to.</p>
      <p v-if="mode === 'password'" class="field-note">First time using a password? Set one from your profile after signing in with an email link, or request a password-reset link below.</p>
      <p v-if="sent" class="success-message" role="status">{{ mode === 'reset' ? 'If this email has an account, a password-reset link is on its way. Check your inbox.' : 'If this email has an account, a sign-in link is on its way. Check your inbox.' }}</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <button v-if="mode !== 'password'" type="button" class="text-button" :disabled="busy" @click="choose('password')">Use email and password</button>
      <button v-if="mode !== 'link'" type="button" class="text-button" :disabled="busy" @click="choose('link')">Use an email sign-in link</button>
      <button v-if="mode !== 'reset'" type="button" class="text-button" :disabled="busy" @click="choose('reset')">Set or reset your password</button>
    </form>
    <NuxtLink to="/join" class="feature-back">Have an invitation code? Join Ósk →</NuxtLink>
  </section><p class="auth-footer">A little space for what matters.</p></main>
</template>
