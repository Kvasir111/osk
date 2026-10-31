<script setup lang="ts">
const { user, demo, signOut } = useAccount()
const { profile, displayName, avatarUrl, loadProfile, saveName, uploadAvatar, removeAvatar } = useProfile()
const name = ref('')
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const message = ref('')
const photoInput = ref<HTMLInputElement>()
onMounted(async () => {
  if (!demo && !user.value) { await navigateTo('/login'); return }
  try { await loadProfile(true); name.value = profile.value?.display_name || '' }
  catch { error.value = 'Your profile could not be loaded. Please reload to try again.' }
  finally { loading.value = false }
})
watch(user, value => { if (!demo && !value) navigateTo('/login') })
async function run(action: () => Promise<void>, success: string) {
  busy.value = true; error.value = ''; message.value = ''
  try { await action(); message.value = success }
  catch (e: any) { error.value = e.data?.statusMessage || e.issues?.[0]?.message || e.message || 'Your profile could not be saved.' }
  finally { busy.value = false }
}
function save() { run(() => saveName(name.value), 'Your name has been updated.') }
async function choosePhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await run(() => uploadAvatar(file), 'Your profile picture has been updated.')
  input.value = ''
}
</script>
<template>
  <main class="profile-page">
    <OskBrand />
    <NuxtLink to="/" class="profile-back"><WishIcon name="arrow" :size="16" />Back to your wishes</NuxtLink>
    <header class="profile-heading"><span class="eyebrow">YOUR SPACE</span><h1>A familiar face.<br /><em>A name of your own.</em></h1><p>Help your people recognize you when you share a list.</p></header>
    <section class="profile-card" aria-label="Your profile">
      <h2>Your profile</h2>
      <p v-if="demo" class="note-box">This demo profile stays in this browser.</p>
      <p v-if="loading" class="muted" role="status">Loading your profile…</p>
      <template v-else-if="profile">
        <div class="profile-picture-row"><UserAvatar :name="name || displayName" :src="avatarUrl" :size="88" /><div><h3>Profile picture</h3><div class="profile-photo-actions"><button class="secondary-button" :disabled="busy" @click="photoInput?.click()"><WishIcon name="plus" :size="16" />{{ avatarUrl ? 'Change picture' : 'Upload picture' }}</button><button v-if="avatarUrl" class="text-button danger" :disabled="busy" @click="run(removeAvatar, 'Your profile picture has been removed.')">Remove picture</button></div><p class="field-note">JPG, PNG, or WebP · up to 3 MB.<br />Your picture is saved when uploaded.</p></div><input ref="photoInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" aria-label="Upload profile picture" :disabled="busy" @change="choosePhoto" /></div>
        <form class="form-stack" @submit.prevent="save"><label>Your name<input v-model="name" autocomplete="name" required maxlength="100" placeholder="Your first and last name" :disabled="busy" /></label><p class="field-note">This is the name your collaborators will see.</p><label v-if="profile.email">Email<input :value="profile.email" type="email" readonly /></label><p v-if="profile.email" class="field-note">Your sign-in email is managed separately from your profile.</p><button class="primary-button profile-save" :disabled="busy">{{ busy ? 'Saving…' : 'Save profile' }}<WishIcon name="check" :size="16" /></button></form>
      </template>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-if="message" class="success-message" role="status">{{ message }}</p>
    </section>
    <button v-if="!demo" class="text-button profile-signout" @click="signOut"><WishIcon name="logout" :size="16" />Sign out</button>
  </main>
</template>
