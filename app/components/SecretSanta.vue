<script setup lang="ts">
import type { FamilyDetail } from '../../shared/types'
import type { SantaEvent, SantaDetail } from '../../shared/santa'
import { santaSchema } from '../../shared/santa'
const props = defineProps<{ family: FamilyDetail }>()
const { api, user, demo } = useAccount()
const store = useWishlists()
const events = ref<SantaEvent[]>([])
const detail = ref<SantaDetail | null>(null)
const selected = ref('')
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const message = ref('')
const name = ref('')
const budget = ref('')
const date = ref('')
const exclusions = ref<[string, string][]>([])
const first = ref('')
const second = ref('')
const organizer = computed(() => props.family.family.owner_id === user.value?.id)
const joined = computed(() => detail.value?.participants.includes(user.value?.id || ''))
const unsaved = computed(() => !!detail.value && (name.value.trim() !== detail.value.event.name ||
  (budget.value ? Math.round(Number(budget.value) * 100) : null) !== detail.value.event.budget_cents ||
  (date.value || null) !== detail.value.event.exchange_date || JSON.stringify(exclusions.value) !== JSON.stringify(detail.value.event.exclusions)))
const identity = (id: string) => props.family.members.find(m => m.user_id === id)?.display_name || 'Former family member'
const recipientLists = computed(() => store.lists.value.filter(l => l.owner_id === detail.value?.recipient_id && props.family.links.some(link => link.list_id === l.id)))
let generation = 0
function fill(event?: SantaEvent) {
  name.value = event?.name || ''; budget.value = event?.budget_cents ? String(event.budget_cents / 100) : ''
  date.value = event?.exchange_date || ''; exclusions.value = event ? event.exclusions.map(pair => [...pair] as [string, string]) : []
  first.value = ''; second.value = ''
}
async function select(id: string) {
  const version = ++generation, account = user.value?.id, familyId = props.family.family.id
  selected.value = id; detail.value = null; fill(); error.value = ''; message.value = ''
  if (!id) return
  loading.value = true
  try {
    const result = await api<SantaDetail>(`/api/santa/${id}`, { accountId: account })
    if (version !== generation || account !== user.value?.id || familyId !== props.family.family.id) return
    detail.value = result; fill(result.event)
  } catch (e: any) { if (version === generation) error.value = e.data?.statusMessage || e.message }
  finally { if (version === generation) loading.value = false }
}
async function load() {
  const version = ++generation, account = user.value?.id, familyId = props.family.family.id
  events.value = []; detail.value = null; selected.value = ''; fill(); error.value = ''; message.value = ''; loading.value = false
  if (demo || !account) return
  loading.value = true
  try {
    const result = await api<SantaEvent[]>(`/api/santa/${familyId}/events`, { accountId: account })
    if (version !== generation || account !== user.value?.id || familyId !== props.family.family.id) return
    events.value = result
    if (result[0]) await select(result[0].id)
  } catch (e: any) { if (version === generation) error.value = e.data?.statusMessage || e.message }
  finally { if (version === generation) loading.value = false }
}
watch(() => [props.family.family.id, user.value?.id], load, { immediate: true })
onBeforeUnmount(() => { generation++ })
async function run(action: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (e: any) { error.value = e.data?.statusMessage || e.message || 'Could not update this event.' }
  finally { busy.value = false }
}
function addExclusion() {
  if (!first.value || !second.value || first.value === second.value) { error.value = 'Choose two different family members.'; return }
  if (!exclusions.value.some(([a, b]) => [a, b].includes(first.value) && [a, b].includes(second.value))) exclusions.value.push([first.value, second.value])
  first.value = ''; second.value = ''; error.value = ''
}
function save() { void run(async () => {
  const input = santaSchema.parse({ name: name.value, budget_cents: budget.value ? Math.round(Number(budget.value) * 100) : null, exchange_date: date.value || null, exclusions: exclusions.value })
  const account = user.value?.id, familyId = props.family.family.id
  const id = selected.value
  const result = await api<{ id?: string }>(id ? `/api/santa/${id}` : `/api/santa/${familyId}/events`, { method: id ? 'PATCH' : 'POST', body: input, accountId: account })
  if (account !== user.value?.id || familyId !== props.family.family.id) return
  const target = id || result.id!
  const updated = await api<SantaEvent[]>(`/api/santa/${familyId}/events`, { accountId: account })
  if (account !== user.value?.id || familyId !== props.family.family.id) return
  events.value = updated
  await select(target); message.value = 'Event saved. Each person can now join.'
}) }
function act(action: 'join' | 'leave' | 'draw' | 'delete') {
  if (action === 'draw' && !confirm('Draw names now? Participants and exclusions will lock. Everyone will see only their own recipient.')) return
  if (action === 'delete' && !confirm('Delete this Secret Santa event and its assignments? This cannot be undone.')) return
  void run(async () => {
    const id = selected.value, familyId = props.family.family.id, account = user.value?.id
    await api(`/api/santa/${id}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST', accountId: account })
    if (account !== user.value?.id || familyId !== props.family.family.id) return
    if (action === 'delete') await load()
    else { await select(id); message.value = action === 'draw' ? 'Names drawn. Your recipient is private to you.' : action === 'join' ? 'You’re in!' : 'You left this event.' }
  })
}
async function openList(id: string) { store.activeId.value = id; await navigateTo('/') }
</script>
<template>
  <section class="feature-panel form-stack" aria-label="Secret Santa">
    <h2>Secret Santa</h2><p class="field-note">One name each, a little shared anticipation. Only you can see your recipient; the organizer cannot see everyone’s assignments.</p>
    <p v-if="demo" class="note-box">Secret Santa needs connected family accounts. Invite your people to the family hub, then create an event here.</p>
    <template v-else>
      <p v-if="error" class="error-message" role="alert">{{ error }} <button type="button" class="text-button" :disabled="busy" @click="load">Reload events</button></p>
      <p v-if="message" class="success-message" role="status">{{ message }}</p>
      <label v-if="events.length">Family event<select :value="selected" :disabled="busy || loading" @change="select(($event.target as HTMLSelectElement).value)"><option v-for="event in events" :key="event.id" :value="event.id">{{ event.name }}{{ event.drawn_at ? ' · drawn' : '' }}</option><option v-if="organizer" value="">Create another event</option></select></label>
      <p v-if="loading" role="status">Opening event…</p>
      <template v-else>
        <template v-if="detail">
          <h3>{{ detail.event.name }}</h3><p class="field-note">{{ detail.event.budget_cents ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(detail.event.budget_cents / 100) + ' gift budget' : 'No set budget' }}{{ detail.event.exchange_date ? ` · Exchange ${detail.event.exchange_date}` : '' }}</p>
          <p>{{ detail.participants.length }} joined · {{ detail.participants.map(identity).join(', ') || 'Be the first to join.' }}</p>
          <template v-if="!detail.event.drawn_at"><button class="secondary-button" :disabled="busy" @click="act(joined ? 'leave' : 'join')">{{ joined ? 'Leave this event' : 'Join this event' }}</button><p class="field-note">Each person joins for themselves. At least three people are needed. Share a wishlist with this family so your Santa has ideas.</p></template>
          <div v-else class="note-box form-stack"><template v-if="detail.recipient_id"><h3>Your recipient: {{ identity(detail.recipient_id) }}</h3><button v-for="list in recipientLists" :key="list.id" class="text-button" @click="openList(list.id)">{{ list.name }} →</button><p v-if="!recipientLists.length">Your recipient hasn’t shared a wishlist with this family yet.</p></template><p v-else>You didn’t take part in this draw.</p><p class="field-note">This draw is locked. Create a new event if the group needs to start over.</p></div>
        </template>
        <form v-if="organizer && !detail?.event.drawn_at" class="form-stack" @submit.prevent="save">
          <h3>{{ selected ? 'Event settings' : 'Create an event' }}</h3>
          <label>Event name<input v-model="name" required maxlength="100" placeholder="Family Christmas" :disabled="busy" /></label>
          <div class="form-row"><label>Gift budget in USD <span class="optional">optional</span><input v-model="budget" type="number" min="0.01" max="1000000" step="0.01" :disabled="busy" /></label><label>Exchange date <span class="optional">optional</span><input v-model="date" type="date" :disabled="busy" /></label></div>
          <fieldset class="photo-list-choices form-stack"><legend>Don’t match these people</legend><p class="field-note">Each pair is excluded in both directions, for example partners. These preferences are visible to the family.</p><div class="form-row"><label>First person<select v-model="first" :disabled="busy"><option value="">Choose a person</option><option v-for="member in family.members" :key="member.user_id" :value="member.user_id">{{ member.display_name }}</option></select></label><label>Second person<select v-model="second" :disabled="busy"><option value="">Choose a person</option><option v-for="member in family.members" :key="member.user_id" :value="member.user_id">{{ member.display_name }}</option></select></label></div><button type="button" class="text-button" :disabled="busy || exclusions.length >= 200" @click="addExclusion">Add excluded pair</button><div v-for="([a, b], index) in exclusions" :key="`${a}:${b}`" class="santa-exclusion"><span>{{ identity(a) }} ↔ {{ identity(b) }}</span><button type="button" class="text-button" :disabled="busy" :aria-label="`Remove exclusion for ${identity(a)} and ${identity(b)}`" @click="exclusions.splice(index, 1)">Remove</button></div></fieldset>
          <button class="primary-button" :disabled="busy">{{ selected ? 'Save event settings' : 'Create Secret Santa event' }}</button>
        </form>
        <template v-if="organizer && detail"><button v-if="!detail.event.drawn_at" class="secondary-button" :disabled="busy || unsaved || detail.participants.length < 3" @click="act('draw')">Draw names</button><p v-if="!detail.event.drawn_at" class="field-note">{{ unsaved ? 'Save your settings before drawing.' : 'The draw uses saved exclusions and locks once completed.' }}</p><button class="text-button danger" :disabled="busy" @click="act('delete')">Delete Secret Santa event</button></template>
        <p v-if="!organizer && !events.length" class="field-note">Your family organizer can create the first event.</p>
      </template>
    </template>
  </section>
</template>
