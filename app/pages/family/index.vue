<script setup lang="ts">
import type { Family, FamilyDetail } from '../../../shared/types'
const { api, demo, user } = useAccount()
const { displayName, avatarUrl, loadProfile } = useProfile()
const store = useWishlists()
const route = useRoute()
const families = ref<Family[]>([])
const details = ref<Record<string, FamilyDetail>>({})
const activeId = ref('')
const active = computed(() => details.value[activeId.value])
const name = ref('')
const newName = ref('')
const listId = ref('')
const invite = ref('')
const inviteExpires = ref('')
const error = ref('')
const message = ref('')
const loading = ref(true)
const busy = ref(false)
const currentUser = computed(() => demo ? 'demo' : user.value?.id)
const organizer = computed(() => active.value?.family.owner_id === currentUser.value)
const sharedLists = computed(() => store.lists.value.filter(l => active.value?.links.some(link => link.list_id === l.id)))
const available = computed(() => store.lists.value.filter(l => l.owner_id === currentUser.value && !active.value?.links.some(link => link.list_id === l.id)))
function persist() { if (demo) localStorage.setItem('osk-demo-families-v1', JSON.stringify(details.value)) }
async function run(fn: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = ''
  try { await fn() } catch (e: any) { error.value = e.data?.statusMessage || e.message || 'Could not update your family hub.' }
  finally { busy.value = false }
}
async function select(id: string) {
  activeId.value = id; invite.value = ''; inviteExpires.value = ''; listId.value = ''; message.value = ''
  if (!demo) details.value[id] = await api(`/api/families/${id}`)
  newName.value = details.value[id]?.family.name || ''
}
onMounted(async () => {
  if (!demo && !user.value) { await navigateTo({ path: '/login', query: { next: '/family' } }); return }
  await run(async () => {
    await store.load()
    try { await loadProfile() } catch { /* Profile is optional for navigating the hub. */ }
    if (demo) {
      try { details.value = JSON.parse(localStorage.getItem('osk-demo-families-v1') || '{}') } catch { details.value = {} }
      families.value = Object.values(details.value).map(d => d.family)
    } else families.value = await api('/api/families')
    const id = families.value.find(f => f.id === route.query.id)?.id || families.value[0]?.id
    if (id) await select(id)
  })
  loading.value = false
})
function create() { run(async () => {
  const family: Family = demo ? { id: crypto.randomUUID(), owner_id: 'demo', name: name.value.trim(), created_at: new Date().toISOString() }
    : await api('/api/families', { method: 'POST', body: { name: name.value } })
  if (demo) details.value[family.id] = { family, members: [{ user_id: 'demo', display_name: displayName.value, avatar_url: avatarUrl.value }], links: [] }
  families.value.push(family); name.value = ''; persist(); await select(family.id)
}) }
function rename() { run(async () => {
  const family = demo ? { ...active.value!.family, name: newName.value.trim() }
    : await api<Family>(`/api/families/${activeId.value}`, { method: 'PATCH', body: { name: newName.value } })
  active.value!.family = family; families.value = families.value.map(f => f.id === family.id ? family : f); persist(); message.value = 'Family name saved.'
}) }
function share() { run(async () => {
  if (!listId.value) return
  if (!demo) await api(`/api/families/${activeId.value}/lists`, { method: 'POST', body: { list_id: listId.value } })
  active.value!.links.push({ list_id: listId.value }); listId.value = ''; persist(); message.value = 'This list is now visible to your family.'
}) }
function unshare(id: string) { run(async () => {
  if (!demo) await api(`/api/families/${activeId.value}/lists`, { method: 'DELETE', body: { list_id: id } })
  active.value!.links = active.value!.links.filter(l => l.list_id !== id); persist(); await store.load(); message.value = 'List removed from this family hub. Other sharing permissions stay in effect.'
}) }
function makeInvite() { run(async () => {
  const result = await api<{ token: string; expires_at: string }>(`/api/families/${activeId.value}/invite`, { method: 'POST' })
  invite.value = `${location.origin}/family/invite/${result.token}`; inviteExpires.value = result.expires_at
}) }
function revoke() { run(async () => { await api(`/api/families/${activeId.value}/invite`, { method: 'DELETE' }); invite.value = ''; message.value = 'All outstanding family invitations revoked. Existing members keep access.' }) }
async function copy() { try { await navigator.clipboard.writeText(invite.value); message.value = 'Invitation copied.' } catch { message.value = 'Select the invitation link to copy it.' } }
function removeMember(id: string) { if (!confirm(id === currentUser.value ? 'Leave this family? Your lists will stop being shared with it.' : 'Remove this member and their shared lists from this family?')) return; run(async () => {
  await api(`/api/families/${activeId.value}/members`, { method: 'DELETE', body: { user_id: id } })
  if (id === currentUser.value) { families.value = families.value.filter(f => f.id !== activeId.value); delete details.value[activeId.value]; activeId.value = ''; if (families.value[0]) await select(families.value[0].id) }
  else await select(activeId.value)
  await store.load(); message.value = 'Family membership updated.'
}) }
function removeFamily() { if (!confirm('Delete this family hub? Everyone keeps their wishlists, but family access and invitations will end.')) return; run(async () => {
  const id = activeId.value
  if (!demo) await api(`/api/families/${id}`, { method: 'DELETE' })
  families.value = families.value.filter(f => f.id !== id); delete details.value[id]; activeId.value = ''; persist()
  if (families.value[0]) await select(families.value[0].id)
  await store.load(); message.value = 'Family hub deleted. Your wishlists are kept.'
}) }
async function openList(id: string) { store.activeId.value = id; await navigateTo('/') }
</script>
<template>
  <main class="feature-page"><OskBrand /><NuxtLink to="/" class="feature-back">← Back to wishes</NuxtLink>
    <header class="feature-header"><span class="eyebrow">YOUR PEOPLE, IN ONE PLACE</span><h1>Family hub</h1><p>A private place to find each other’s wishes. Share only the lists you choose.</p></header>
    <p v-if="demo" class="note-box">Local preview. You can create a hub and choose lists here; invitations and other members need connected accounts.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="message" class="success-message" role="status">{{ message }}</p>
    <p v-if="loading" role="status">Opening your family hub…</p>
    <div v-else class="family-layout">
      <aside class="feature-panel form-stack"><h2>Your families</h2><nav aria-label="Families"><button v-for="family in families" :key="family.id" class="list-nav" :class="{active: activeId === family.id}" :disabled="busy" @click="run(() => select(family.id))">{{ family.name }}</button></nav><p v-if="!families.length" class="field-note">Create a family, or accept an invitation from someone you know.</p><form class="form-stack" @submit.prevent="create"><label>New family name<input v-model="name" required maxlength="100" placeholder="Our family" /></label><button class="primary-button" :disabled="busy">Create family</button></form></aside>
      <section v-if="active" class="form-stack family-main"><div class="feature-panel form-stack"><h2>{{ active.family.name }}</h2><h3>Shared wishlists</h3><p class="field-note">Family access is view-only. Existing list collaborators keep their editing permissions.</p><article v-for="list in sharedLists" :key="list.id" class="family-list-row"><div><button class="text-button" @click="openList(list.id)">{{ list.name }} ↗</button><p class="field-note">{{ active.members.find(m => m.user_id === list.owner_id)?.display_name || 'Family member' }} · {{ list.description || 'A few good wishes' }}</p></div><button v-if="organizer || list.owner_id === currentUser" class="text-button danger" :disabled="busy" @click="unshare(list.id)">Stop sharing</button></article><p v-if="!sharedLists.length" class="empty-inline">No lists shared yet. Your private lists stay private until you share them here.</p><form v-if="available.length" class="form-stack" @submit.prevent="share"><label>Share one of your lists<select v-model="listId" required><option value="" disabled>Choose a list</option><option v-for="list in available" :key="list.id" :value="list.id">{{ list.name }}</option></select></label><button class="secondary-button" :disabled="busy || !listId">Share with family</button></form><NuxtLink v-else to="/" class="text-button">Make another wishlist →</NuxtLink></div>
        <SecretSanta :key="active.family.id" :family="active" />
        <div class="feature-panel form-stack"><h3>Your people</h3><div v-for="member in active.members" :key="member.user_id" class="member-row"><div class="collaborator-identity"><UserAvatar :name="member.display_name" :src="member.avatar_url" /><div><strong>{{ member.display_name }}</strong><span>{{ member.user_id === active.family.owner_id ? 'Organizer' : 'Member' }}{{ member.user_id === currentUser ? ' · you' : '' }}</span></div></div><button v-if="!demo && organizer && member.user_id !== currentUser" class="text-button danger" :disabled="busy" @click="removeMember(member.user_id)">Remove member</button></div><button v-if="!demo && !organizer" class="text-button danger" :disabled="busy" @click="removeMember(currentUser!)">Leave family</button>
          <template v-if="organizer"><hr /><h3>Invite your people</h3><p class="field-note">Anyone with an invitation and an approved Ósk account can join. Links expire in 7 days. Share invitations privately.</p><button class="secondary-button" :disabled="busy || demo" @click="makeInvite">Create family invitation</button><div v-if="invite" class="form-stack"><div class="copy-row"><input :value="invite" readonly aria-label="Family invitation link" @focus="($event.target as HTMLInputElement).select()" /><button class="secondary-button" @click="copy">Copy</button></div><p class="field-note">Expires {{ new Date(inviteExpires).toLocaleString('en-US') }}</p></div><button class="text-button danger" :disabled="busy || demo" @click="revoke">Revoke outstanding invitations</button><hr /><form class="form-stack" @submit.prevent="rename"><label>Family name<input v-model="newName" required maxlength="100" /></label><button class="secondary-button" :disabled="busy">Save family name</button></form><button class="text-button danger" :disabled="busy" @click="removeFamily">Delete family hub</button></template>
        </div>
      </section>
      <section v-else class="feature-panel empty-state"><WishIcon name="heart" :size="36" /><h2>A place for your people.</h2><p>Create your first family hub to bring everyone’s lists together.</p></section>
    </div>
  </main>
</template>
