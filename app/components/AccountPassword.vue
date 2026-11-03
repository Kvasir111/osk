<script setup lang="ts">
const emit = defineEmits<{ saved: [] }>()
const { user, client, demo } = useAccount()
const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const error = ref('')
const success = ref(false)
watch(() => user.value?.id, () => { password.value = ''; confirmation.value = ''; error.value = ''; success.value = false })
onBeforeUnmount(() => { password.value = ''; confirmation.value = '' })
async function save() {
  if (busy.value || !client || demo) return
  error.value = ''; success.value = false
  if (!navigator.onLine) { error.value = 'Reconnect before setting your password.'; return }
  if (password.value.length < 12) { error.value = 'Use at least 12 characters for your password.'; return }
  if (password.value !== confirmation.value) { error.value = 'The passwords don’t match.'; return }
  const account = user.value?.id
  if (!account) { error.value = 'Sign in again before setting your password.'; return }
  busy.value = true
  try {
    const { error: authError } = await client.auth.updateUser({ password: password.value })
    if (account !== user.value?.id) return
    if (authError) {
      const code = authError.code
      error.value = code === 'weak_password' ? 'This password does not meet the account’s security requirements. Try a longer, unique password.'
        : code === 'same_password' ? 'Choose a different password from your current one.'
        : ['reauthentication_needed', 'reauthentication_not_valid', 'session_not_found', 'refresh_token_not_found'].includes(code || '') ? 'Please use a fresh password-reset email from the sign-in page, then try again.'
        : 'Your password could not be saved. Try again, or request a fresh password-reset email from the sign-in page.'
      return
    }
    password.value = ''; confirmation.value = ''; success.value = true
    emit('saved')
  } catch { if (account === user.value?.id) error.value = 'Your password could not be saved. Check your connection and try again.' }
  finally { busy.value = false }
}
</script>
<template>
  <form class="form-stack" @submit.prevent="save">
    <label>New password<input v-model="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :disabled="busy" aria-describedby="password-help" /></label>
    <p id="password-help" class="field-note">Use at least 12 characters. A unique passphrase or a password manager works well.</p>
    <label>Confirm password<input v-model="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :disabled="busy" /></label>
    <button class="primary-button" :disabled="busy || demo || !user">{{ busy ? 'Saving…' : 'Save password' }}</button>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="success" class="success-message" role="status">Your password has been saved. You can now sign in with your email and password.</p>
  </form>
</template>
