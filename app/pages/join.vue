<script setup lang="ts">
import { redeemInvitationSchema } from '../../shared/account-invitations'
const { demo } = useAccount()
const code = ref('')
const email = ref('')
const busy = ref(false)
const sent = ref(false)
const error = ref('')
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] })
onMounted(() => {
  // A fragment never reaches server access logs. Remove it from browser history too.
  code.value = new URLSearchParams(location.hash.slice(1)).get('code') || ''
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
})
async function redeem() {
  if (busy.value) return
  const input = redeemInvitationSchema.safeParse({ code: code.value, email: email.value })
  if (!input.success) { error.value = input.error.issues[0]?.message || 'Check your email and invitation code.'; return }
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/account-invitations/redeem', { method: 'POST', body: input.data })
    sent.value = true; code.value = ''
  } catch (e: any) { error.value = e.data?.statusMessage || 'The invitation could not be accepted. Check the code or ask for a new one.' }
  finally { busy.value = false }
}
</script>
<template>
  <main class="auth-page"><OskBrand /><section class="auth-card"><span class="eyebrow">YOU’RE INVITED</span><h1>A few good wishes.<br /><em>And your people.</em></h1><p>Enter your invitation code and email to join Ósk. We’ll email a secure link so you can set up your profile.</p>
    <p v-if="demo" class="note-box">Invitations aren’t available in the local demo.</p>
    <p v-else-if="sent" class="success-message" role="status">Check your inbox for your invitation or sign-in link. Open it to verify your email and finish joining.</p>
    <form v-else class="form-stack" @submit.prevent="redeem"><label>Invitation code<input v-model="code" required maxlength="100" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" /></label><label>Your email<input v-model="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com" /></label><p class="field-note">Codes expire after seven days and are tied to the first email that uses them.</p><button class="primary-button full" :disabled="busy">{{ busy ? 'Sending your link…' : 'Accept invitation' }}<WishIcon name="arrow" :size="17" /></button></form>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><NuxtLink class="feature-back" to="/login">Already have an account? Sign in →</NuxtLink>
  </section></main>
</template>
