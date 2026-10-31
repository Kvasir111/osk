<script setup lang="ts">
import type { AccountInvitation } from '../../shared/account-invitations'
const { user, demo, api } = useAccount()
const email = ref('')
const loading = ref(true)
const busy = ref(false)
const allowed = ref(false)
const invitations = ref<AccountInvitation[]>([])
const code = ref('')
const error = ref('')
const message = ref('')
const inviteLink = computed(() => code.value && import.meta.client ? `${location.origin}/join#code=${code.value}` : '')
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
async function load() {
  const data = await api<{ can_invite: boolean; invitations: AccountInvitation[] }>('/api/account-invitations')
  allowed.value = data.can_invite; invitations.value = data.invitations
}
onMounted(async () => {
  if (!demo && !user.value) { await navigateTo({ path: '/login', query: { next: '/invitations' } }); return }
  try { if (!demo) await load() }
  catch (e: any) { error.value = e.data?.statusMessage || 'Invitations could not load.' }
  finally { loading.value = false }
})
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await action() }
  catch (e: any) { error.value = e.data?.statusMessage || 'The invitation could not be updated.' }
  finally { try { await load() } catch { error.value ||= 'Reload to check your invitations.' }; busy.value = false }
}
function sendEmail() { run(async () => {
  await api('/api/account-invitations', { method: 'POST', body: { kind: 'email', email: email.value } })
  message.value = `Invitation email sent to ${email.value.trim()}.`; email.value = ''
}) }
function makeCode() { run(async () => {
  code.value = ''
  const result = await api<{ code: string }>('/api/account-invitations', { method: 'POST', body: { kind: 'code' } })
  code.value = result.code
}) }
function revoke(id: string) { run(async () => {
  await api(`/api/account-invitations/${id}`, { method: 'DELETE' })
  code.value = ''; message.value = 'Invitation revoked. Existing accounts keep their access.'
}) }
function resend(id: string) { run(async () => {
  await api(`/api/account-invitations/${id}/resend`, { method: 'POST' })
  message.value = 'A new email has been sent.'
}) }
function active(invite: AccountInvitation) { return !invite.revoked_at && new Date(invite.expires_at).getTime() > Date.now() }
function status(invite: AccountInvitation) {
  if (invite.revoked_at) return 'Revoked'
  if (!active(invite)) return 'Expired'
  if (invite.delivery_status === 'failed') return 'Email failed — retry available'
  if (invite.sent_at) return 'Email sent'
  return invite.recipient_email ? 'Email pending' : 'Ready to share'
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); message.value = 'Copied.' }
  catch { message.value = 'Select the invitation text to copy it.' }
}
</script>
<template>
  <main class="feature-page invitations-page"><OskBrand /><NuxtLink class="feature-back" to="/">← Back to wishes</NuxtLink>
    <header class="feature-header"><span class="eyebrow">A PLACE FOR YOUR PEOPLE</span><h1>Invite someone to Ósk.</h1><p>Welcome friends and family with an email or a personal invitation code.</p></header>
    <p v-if="loading" role="status">Loading invitations…</p>
    <p v-else-if="demo" class="note-box">Account invitations need a connected Supabase project and an invitation administrator.</p>
    <p v-else-if="!allowed" class="note-box">Your account can’t create account invitations. Ask your Ósk administrator for an invitation. <NuxtLink to="/join">Have a code? →</NuxtLink></p>
    <template v-else>
      <div class="invitation-methods">
        <section class="feature-panel form-stack"><h2>Send an email</h2><p class="field-note">They’ll receive a secure link to verify their email and set up their profile.</p><form class="form-stack" @submit.prevent="sendEmail"><label>Their email<input v-model="email" type="email" required maxlength="254" autocomplete="off" placeholder="someone@example.com" /></label><button class="primary-button" :disabled="busy">Send invitation<WishIcon name="arrow" :size="17" /></button></form></section>
        <section class="feature-panel form-stack"><h2>Share a code</h2><p class="field-note">One code welcomes one email address. It expires in seven days. Send it privately as a code or a link.</p><button class="secondary-button" :disabled="busy" @click="makeCode">Generate invitation code</button><div v-if="code" class="form-stack"><label>Invitation code<input :value="code" readonly @focus="($event.target as HTMLInputElement).select()" /></label><div class="photo-actions"><button class="secondary-button" @click="copy(code)">Copy code</button><button class="secondary-button" @click="copy(inviteLink)">Copy invitation link</button></div><p class="field-note">Copy it now. For privacy, the full code is only shown here once.</p></div></section>
      </div>
      <section class="feature-panel form-stack"><h2>Your invitations</h2><p class="field-note">Each invitation allows up to five email attempts, at least a minute apart. Revoking stops further use; it does not remove an account or invalidate an email already sent.</p><p v-if="!invitations.length" class="field-note">No invitations yet.</p><article v-for="invite in invitations" :key="invite.id" class="account-invitation-row"><div><strong>{{ invite.recipient_email || 'Invitation code' }}</strong><p class="field-note">{{ status(invite) }} · Expires {{ new Date(invite.expires_at).toLocaleDateString() }}</p></div><div v-if="active(invite)" class="photo-actions"><button v-if="invite.recipient_email" class="text-button" :disabled="busy" @click="resend(invite.id)">Resend email</button><button class="text-button danger" :disabled="busy" @click="revoke(invite.id)">Revoke</button></div></article></section>
      <p class="field-note">Account invitations grant access to Ósk. Use the <NuxtLink to="/family">Family hub</NuxtLink> to invite people into a family and choose which lists to share.</p>
    </template>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="message" class="success-message" role="status">{{ message }}</p>
  </main>
</template>
