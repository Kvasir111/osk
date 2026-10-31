<script setup lang="ts">
import type { WishList } from '../../shared/types'
const props = defineProps<{ list: WishList }>()
const emit = defineEmits<{ updated: [token: string | null] }>()
const { api, demo } = useAccount()
const token = ref(props.list.share_token)
const invite = ref('')
const inviteRole = ref<'editor' | 'viewer'>('editor')
const busy = ref(false)
const error = ref('')
const message = ref('')
const members = ref<{ user_id: string; role: string; email: string; display_name: string; avatar_url: string | null }[]>([])
const shareUrl = computed(() => token.value ? `${location.origin}/share/${token.value}` : '')
async function run(fn: () => Promise<void>) { busy.value = true; error.value = ''; message.value = ''; try { await fn() } catch (e: any) { error.value = e.data?.statusMessage || 'Could not update sharing.' } finally { busy.value = false } }
function sharing(enabled: boolean, rotate = false) { run(async () => {
  const data = await api<{ token: string | null }>(`/api/lists/${props.list.id}/share`, { method: 'POST', body: { enabled, rotate } })
  token.value = data.token; emit('updated', data.token)
}) }
function makeInvite() { run(async () => {
  const data = await api<{ token: string }>(`/api/lists/${props.list.id}/invite`, { method: 'POST', body: { role: inviteRole.value } })
  invite.value = `${location.origin}/invite/${data.token}`
}) }
async function copy(value: string) { try { await navigator.clipboard.writeText(value); message.value = 'Link copied.' } catch { message.value = 'Select the link above to copy it.' } }
onMounted(async () => { if (!demo) { try { members.value = await api(`/api/lists/${props.list.id}/members`) } catch { error.value = 'Could not load collaborators.' } } })
function removeMember(userId: string) { run(async () => {
  await api(`/api/lists/${props.list.id}/members`, { method: 'DELETE', body: { user_id: userId } })
  members.value = members.value.filter(m => m.user_id !== userId)
}) }
function revokeInvites() { run(async () => { await api(`/api/lists/${props.list.id}/invite`, { method: 'DELETE' }); invite.value = ''; message.value = 'All outstanding invitations revoked. Existing members keep their access.' }) }
</script>
<template>
  <div class="form-stack">
    <p class="muted">Good wishes are better shared. Choose who can look and who can lend a hand.</p>
    <p v-if="demo" class="note-box">Sharing becomes available when accounts are connected. Your demo lists stay in this browser.</p>
    <section class="sharing-section"><WishIcon name="link" :size="25" /><div><h3>A link for your people</h3><p>Anyone with this link can view this list without signing in.</p></div></section>
    <template v-if="token"><div class="copy-row"><input :value="shareUrl" readonly aria-label="View-only sharing link" @focus="($event.target as HTMLInputElement).select()" /><button class="secondary-button" @click="copy(shareUrl)">Copy</button></div><div class="modal-actions"><button class="text-button" :disabled="busy || demo" @click="sharing(true, true)">Replace link</button><button class="text-button danger" :disabled="busy || demo" @click="sharing(false)">Turn off sharing</button></div></template>
    <button v-else class="secondary-button" :disabled="busy || demo" @click="sharing(true)">Create view-only link<WishIcon name="arrow" :size="16" /></button>
    <hr />
    <section class="sharing-section"><WishIcon name="user" :size="25" /><div><h3>Invite a collaborator</h3><p>Recipients sign in with an approved account. Invitation links expire in 7 days.</p></div></section>
    <div class="form-row"><label>Access<select v-model="inviteRole"><option value="editor">Can add, edit, and remove items</option><option value="viewer">Can view only</option></select></label><button class="primary-button self-end" :disabled="busy || demo" @click="makeInvite">Create invite</button></div>
    <div v-if="invite" class="copy-row"><input :value="invite" readonly aria-label="Collaboration invitation link" @focus="($event.target as HTMLInputElement).select()" /><button class="secondary-button" @click="copy(invite)">Copy</button></div>
    <button class="text-button danger" :disabled="busy || demo" @click="revokeInvites">Revoke all outstanding invitations</button>
    <div v-if="members.length"><span class="eyebrow">COLLABORATORS</span><div v-for="member in members" :key="member.user_id" class="member-row"><div class="collaborator-identity"><UserAvatar :name="member.display_name || member.email || 'Family member'" :src="member.avatar_url" /><div><strong>{{ member.display_name || member.email || 'Family member' }}</strong><span>{{ member.role }}{{ member.display_name && member.email ? ` · ${member.email}` : '' }}</span></div></div><button class="text-button danger" :disabled="busy" @click="removeMember(member.user_id)">Remove access</button></div></div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="message" class="success-message" role="status">{{ message }}</p>
  </div>
</template>
