<script setup lang="ts">
import type { ProductDraft, WishItem, PriceCheckDetails } from '../../shared/types'
import { money, savings, bestOffer } from '../../shared/pricing'
const { user, demo, api, signOut } = useAccount()
const { displayName, avatarUrl, loadProfile } = useProfile()
const store = useWishlists()
const { lists, items, active, activeId, activeItems, canEdit, isOwner, loaded } = store
const modal = ref<'list' | 'edit-list' | 'manual' | 'edit-item' | 'repair' | 'detail' | 'search' | 'share' | null>(null)
const selected = ref<WishItem>()
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const toast = ref('')
const search = ref('')
const captureSeed = ref<string>()
const captureName = ref<string>()
function manualFromSearch(url?: string, name?: string) { captureSeed.value = url; captureName.value = name; error.value = ''; modal.value = 'manual' }
const filter = ref('All wishes')
const sort = ref('recent')
const listForm = reactive({ name: '', description: '', occasion: 'everyday' as 'everyday' | 'christmas' | 'birthday' | 'other' })
const confirmDelete = ref(false)
const refreshing = ref<string[]>([])
const mobileMenu = ref(false)
const tabs = ['All wishes', 'On sale', 'Tech', 'Home', 'Style', 'Books', 'Outdoors', 'Other']
const saleItems = computed(() => activeItems.value.filter(i => savings(i)))
const totalSavings = computed(() => activeItems.value.reduce((sum, i) => sum + (savings(i)?.cents || 0), 0))
const filtered = computed(() => {
  const result = activeItems.value.filter(i => filter.value === 'All wishes' || (filter.value === 'On sale' ? savings(i) : i.category === filter.value))
  return [...result].sort((a, b) => sort.value === 'price' ? (bestOffer(a.offers)?.price_cents ?? Infinity) - (bestOffer(b.offers)?.price_cents ?? Infinity)
    : sort.value === 'savings' ? (savings(b)?.cents || 0) - (savings(a)?.cents || 0) : b.created_at.localeCompare(a.created_at))
})
let toastTimer: ReturnType<typeof setTimeout>
function notify(message: string) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = '' }, 4500) }
onBeforeUnmount(() => clearTimeout(toastTimer))
async function run(fn: () => Promise<void>) {
  busy.value = true; error.value = ''
  try { await fn() } catch (e: any) { error.value = e.data?.statusMessage || e.message || 'Something went wrong. Please try again.' }
  finally { busy.value = false }
}
onMounted(async () => {
  if (!demo && !user.value) { await navigateTo('/login'); return }
  await run(() => store.load()); loading.value = false
  try { await loadProfile() } catch { /* Keep the account link usable if profile loading fails. */ }
})
watch(user, value => { if (!demo && !value) navigateTo('/login') })
watch(activeId, () => { filter.value = 'All wishes'; mobileMenu.value = false })
function openList(editing = false) {
  Object.assign(listForm, editing && active.value ? active.value : { name: '', description: '', occasion: 'everyday' })
  confirmDelete.value = false; modal.value = editing ? 'edit-list' : 'list'
}
function saveList() { run(async () => {
  const input = { name: listForm.name, description: listForm.description, occasion: listForm.occasion }
  if (modal.value === 'edit-list') await store.updateList(input); else await store.createList(input)
  modal.value = null; notify('Your list is ready.')
}) }
function saveItem(product: ProductDraft, checkedAt: string | null = null, details?: PriceCheckDetails, searchId?: string) { run(async () => {
  await store.saveItem(product, checkedAt, modal.value === 'edit-item' || modal.value === 'repair' ? selected.value?.id : undefined, details, searchId)
  modal.value = null; notify(store.pending.value.length ? 'Saved on this device. Waiting to sync.' : 'A good wish, saved.')
}) }
function openItem(item: WishItem) { selected.value = item; modal.value = 'detail' }
async function refresh(id: string) {
  if (refreshing.value.includes(id)) return
  refreshing.value.push(id); error.value = ''
  try {
    const result = await api<{ status: string }>(`/api/items/${id}/refresh`, { method: 'POST' })
    await store.load()
    if (selected.value?.id === id) selected.value = store.items.value.find(i => i.id === id)
    notify(result.status === 'failed' ? 'Price check failed. Open the item for details; previous prices kept.' : result.status === 'skipped' ? 'This item was checked recently. Try again in a few minutes.' : 'Prices refreshed.')
  } catch (e: any) { error.value = e.data?.statusMessage || 'The price check could not finish.' }
  finally { refreshing.value = refreshing.value.filter(item => item !== id) }
}
function removeItem() { run(async () => { await store.deleteItem(selected.value!.id); modal.value = null; notify('Item removed.') }) }
function removeList() { run(async () => { await store.deleteList(); modal.value = null; notify('List removed.') }) }
function openSearch() { if (active.value && canEdit.value) modal.value = 'search' }
const occasionIcon = (occasion: string) => occasion === 'everyday' ? 'heart' : 'gift'
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ 'mobile-open': mobileMenu }">
      <OskBrand />
      <p class="sidebar-tagline">Considered things. Shared wishes.</p>
      <div class="sidebar-divider"></div>
      <div class="nav-section-title">YOUR COLLECTION <button class="icon-button" aria-label="Create a wishlist" @click="openList()"><WishIcon name="plus" :size="17" /></button></div>
      <nav aria-label="Wishlists"><button v-for="list in lists" :key="list.id" class="list-nav" :class="{ active: activeId === list.id }" @click="activeId = list.id"><WishIcon :name="occasionIcon(list.occasion)" :size="18" /><span>{{ list.name }}</span><span class="list-count">{{ items.filter(i => i.list_id === list.id).length }}</span></button></nav>
      <button class="new-list-button" @click="openList()"><WishIcon name="plus" :size="17" />Make a new list</button>
      <NuxtLink to="/family" class="new-list-button"><WishIcon name="user" :size="17" />Family hub</NuxtLink>
      <NuxtLink to="/invitations" class="new-list-button"><WishIcon name="plus" :size="17" />Invite people</NuxtLink>
      <NuxtLink to="/capture" class="new-list-button"><WishIcon name="link" :size="17" />Quick capture</NuxtLink>
      <PwaInstall />
      <div class="sidebar-bottom"><div class="little-note"><WishIcon name="gift" :size="25" /><p>Buy with intention.<br /><strong>Give with thought.</strong></p></div>
        <div class="account-row"><NuxtLink to="/profile" class="account-profile-link" aria-label="Edit your profile"><UserAvatar :name="displayName" :src="avatarUrl" /><div><strong>{{ displayName }}</strong><span>Edit profile{{ demo ? ' · demo' : '' }}</span></div></NuxtLink><button v-if="!demo" class="icon-button" aria-label="Sign out" @click="signOut"><WishIcon name="logout" :size="17" /></button><WishIcon v-else name="heart" :size="16" /></div>
      </div>
    </aside>
    <button v-if="mobileMenu" class="mobile-overlay" aria-label="Close menu" @click="mobileMenu = false"></button>
    <main class="main-content">
      <header class="topbar"><div><button class="icon-button mobile-toggle" aria-label="Open wishlist menu" @click="mobileMenu = !mobileMenu"><WishIcon name="menu" /></button><span class="topbar-label">YOUR WISHES, IN GOOD COMPANY</span></div><span class="topbar-note"><span class="status-dot"></span>{{ demo ? 'Make yourself at home' : 'Made for you & your people' }}</span></header>
      <div v-if="demo" class="demo-banner"><span><strong>Preview.</strong> Sample prices, local lists. Nothing here is being tracked yet.</span><NuxtLink to="/login">About setup <WishIcon name="arrow" :size="14" /></NuxtLink></div>
      <div class="page-content">
        <section class="welcome"><div><div class="eyebrow"><span class="tiny-line"></span>COLLECT WITH INTENTION</div><h1>Wishes,<br /><em>kept simply.</em></h1><p>Save what speaks to you. Share it with your people.</p></div><div class="welcome-art" aria-hidden="true"><svg class="nordic-landscape" viewBox="0 0 260 210" fill="none"><circle cx="174" cy="62" r="27" fill="var(--osk-sand)"/><path d="M20 154 93 57l69 97" stroke="var(--osk-fog)" stroke-width="1.5"/><path d="m86 154 70-73 84 73" fill="var(--osk-mist)"/><path d="m20 154 73-97 26 37-26-14-31 35" fill="var(--osk-fog)"/><path d="M12 154h236M36 168h186M68 182h120" stroke="var(--osk-line)" stroke-width="1"/><path d="M174 18v8m36 36h8M136 62h-8" stroke="var(--osk-sand)" stroke-width="1"/></svg><span class="landscape-caption">ROOM FOR WHAT MATTERS</span></div></section>
        <section class="assistant-strip"><div class="assistant-heading"><span class="sparkle-square"><WishIcon name="sparkle" :size="21" /></span><div><h2>Have something in mind?</h2><p>Paste a store link to read its details and price.</p></div></div><form class="assistant-input" @submit.prevent="openSearch"><input v-model="search" aria-label="Find a product for your wishlist" placeholder="Paste a product link from any store…" maxlength="2048" :disabled="!active || !canEdit" /><button :disabled="!active || !canEdit" aria-label="Search for products"><WishIcon name="arrow" :size="20" /></button></form></section>
        <div v-if="error" class="error-message page-error" role="alert">{{ error }}<button class="icon-button" aria-label="Dismiss error" @click="error = ''"><WishIcon name="close" :size="15" /></button></div>
        <div v-if="loading" class="page-loading" role="status"><WishIcon name="refresh" class="spinning" /> Gathering your wishes…</div>
        <template v-else>
          <section v-if="active" class="stats-grid" aria-label="List overview"><div class="stat"><span class="stat-icon pale-lilac"><WishIcon name="heart" :size="20" /></span><div><strong>{{ activeItems.length }}</strong><span>{{ activeItems.length === 1 ? 'wish on your list' : 'wishes on your list' }}</span></div></div><div class="stat"><span class="stat-icon pale-green"><WishIcon name="trend" :size="21" /></span><div><strong>{{ saleItems.length }}<small> worth a look</small></strong><span>currently below MSRP{{ demo ? ' · sample' : '' }}</span></div></div><div class="stat"><span class="stat-icon pale-yellow"><WishIcon name="sparkle" :size="20" /></span><div><strong>{{ money(totalSavings) }}</strong><span>potential savings{{ demo ? ' · sample' : '' }}</span></div></div></section>
          <section class="list-section">
            <div class="list-heading"><div><div class="eyebrow">{{ active ? (isOwner ? 'YOUR WISHLIST' : 'SHARED WITH YOU') : 'ROOM FOR SOMETHING GOOD' }}</div><h2>{{ active?.name || 'Your first wish starts here.' }}<button v-if="active && isOwner" class="icon-button" aria-label="Edit list" @click="openList(true)"><WishIcon name="edit" :size="16" /></button></h2><p>{{ active?.description || 'Make a list for a season, a celebration, or simply someday.' }}</p></div><div class="list-actions"><button v-if="active && isOwner" class="secondary-button" @click="modal = 'share'"><WishIcon name="share" :size="16" />Share list</button><button v-if="active && canEdit" class="primary-button" @click="manualFromSearch()"><WishIcon name="plus" :size="17" />Add a wish</button><button v-if="!active" class="primary-button" @click="openList()"><WishIcon name="plus" :size="17" />Create a list</button></div></div>
            <div v-if="active" class="filter-row"><div class="filter-tabs" role="group" aria-label="Filter wishes"><button v-for="tab in tabs.filter(t => ['All wishes', 'On sale'].includes(t) || activeItems.some(i => i.category === t))" :key="tab" :class="{ selected: filter === tab }" :aria-pressed="filter === tab" @click="filter = tab">{{ tab }}<span v-if="tab === 'All wishes'">{{ activeItems.length }}</span><span v-if="tab === 'On sale'" class="sale-dot"></span></button></div><label class="sort-label">Sort by<select v-model="sort" aria-label="Sort wishes"><option value="recent">Recently added</option><option value="price">Lowest price</option><option value="savings">Biggest savings</option></select></label></div>
            <div v-if="filtered.length" class="product-grid"><ProductCard v-for="item in filtered" :key="item.id" :item="item" :demo="demo" :editable="canEdit" :refreshing="refreshing.includes(item.id)" @open="openItem" @refresh="refresh" /><button v-if="canEdit" class="add-card" @click="manualFromSearch()"><span><WishIcon name="plus" :size="26" /></span><strong>Room for one more.</strong><p>The next good thing<br />belongs right here.</p></button></div>
            <div v-else class="empty-state"><span class="empty-icon"><WishIcon :name="filter === 'On sale' ? 'clock' : 'gift'" :size="38" /></span><h3>{{ !active ? 'Make room for a few good things.' : filter === 'On sale' ? 'Good things take a little patience.' : 'A blank page for your next favorite.' }}</h3><p>{{ !active ? 'Christmas, birthdays, or just because. Give your wishes a home.' : filter !== 'All wishes' ? 'No wishes match this filter yet.' : 'Add a product from any store, or paste its link to read the details.' }}</p><button v-if="active && canEdit && filter === 'All wishes'" class="secondary-button" @click="manualFromSearch()">Add your first wish<WishIcon name="arrow" :size="17" /></button></div>
          </section>
          <footer class="page-footer"><span><WishIcon name="clock" :size="14" />{{ demo ? 'Daily checks begin after setup.' : 'Prices checked daily · 12:00 UTC' }}</span><span>Less searching. More meaning. </span></footer>
        </template>
      </div>
    </main>
    <WishModal v-if="modal === 'list' || modal === 'edit-list'" :title="modal === 'list' ? 'Make room for a few wishes.' : 'A little list housekeeping.'" @close="modal = null"><form class="form-stack" @submit.prevent="saveList"><label>List name<input v-model="listForm.name" required maxlength="100" placeholder="Christmas wishes, Birthday ideas…" /></label><label>Occasion<select v-model="listForm.occasion"><option value="everyday">Just because</option><option value="christmas">Christmas</option><option value="birthday">Birthday</option><option value="other">Another occasion</option></select></label><label>A little introduction<textarea v-model="listForm.description" maxlength="500" placeholder="A note for the people you’ll share this with." rows="3" /></label><button class="primary-button full" :disabled="busy">{{ busy ? 'Saving…' : modal === 'list' ? 'Create my list' : 'Save changes' }}<WishIcon name="arrow" :size="17" /></button><button v-if="modal === 'edit-list'" type="button" class="text-button danger" :disabled="busy" @click="confirmDelete ? removeList() : confirmDelete = true">{{ confirmDelete ? 'Confirm: delete this list and its items' : 'Delete this list' }}</button><p v-if="error" class="error-message" role="alert">{{ error }}</p></form></WishModal>
    <WishModal v-if="modal === 'manual' || modal === 'edit-item'" :title="modal === 'manual' ? 'Something to wish for.' : 'It’s all in the details.'" wide @close="modal = null"><ItemEditor :item="modal === 'edit-item' ? selected : undefined" :busy="busy" :initial-url="modal === 'manual' ? captureSeed : undefined" :initial-name="modal === 'manual' ? captureName : undefined" @save="saveItem" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
    <WishModal v-if="modal === 'detail' && selected" :title="selected.name" wide @close="modal = null"><ProductDetails :item="selected" :editable="canEdit" :demo="demo" @edit="modal = 'edit-item'" @repair="modal = 'repair'" @remove="removeItem" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
    <WishModal v-if="modal === 'repair' && selected && canEdit" title="Fix price tracking" wide @close="modal = null"><TrackingRepair :item="selected" :saving="busy" @save="saveItem" @manual="modal = 'edit-item'" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
    <WishModal v-if="modal === 'search'" title="Let’s find your next favorite." wide @close="modal = null"><ProductSearch :initial-query="search" :saving="busy" @approve="saveItem" @manual="manualFromSearch" /><p v-if="error" class="error-message" role="alert">{{ error }}</p></WishModal>
    <WishModal v-if="modal === 'share' && active" title="A wish shared is a hint given." @close="modal = null"><ShareList :list="active" @updated="active.share_token = $event" /></WishModal>
    <div v-if="toast" class="toast" role="status"><WishIcon name="check" :size="18" />{{ toast }}</div>
  </div>
</template>
