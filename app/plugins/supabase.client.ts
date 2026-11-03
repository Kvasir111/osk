import { lastOfflineIdentity } from '../utils/offline-storage'
import { createClient } from '@supabase/supabase-js'
import type { User, SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin({ name: 'supabase', async setup() {
  const config = useRuntimeConfig().public
  const user = useState<User | null>('account-user', () => null)
  const recovery = useState('account-password-recovery', () => false)
  const callbackFailed = useState('account-auth-callback-failed', () => false)
  const fragment = new URLSearchParams(location.hash.slice(1))
  // Capture recovery intent before the SDK consumes the fragment. This controls UI only;
  // Supabase still validates the session before a password can be changed.
  recovery.value = fragment.get('type') === 'recovery'
  callbackFailed.value = fragment.has('error') || new URLSearchParams(location.search).has('error')
  const client: SupabaseClient | null = config.supabaseUrl && config.supabasePublishableKey
    ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null
  if (client) {
    if (navigator.onLine) {
      const { error: initializationError } = await client.auth.initialize()
      if (initializationError && (recovery.value || ['access_token', 'refresh_token', 'error'].some(key => fragment.has(key)))) callbackFailed.value = true
      const { data, error } = await client.auth.getSession()
      if (error && recovery.value) callbackFailed.value = true
      user.value = data.session?.user ?? null
      if (fragment.has('access_token') || fragment.has('refresh_token') || fragment.has('error')) {
        history.replaceState(history.state, '', location.pathname + location.search)
      }
    } else {
      client.auth.stopAutoRefresh()
      // Cached identity is only for this device's offline UI, never server authorization.
      user.value = await lastOfflineIdentity().catch(() => undefined) as User || null
    }
    client.auth.onAuthStateChange((event, session) => {
      if (!navigator.onLine && !session) return
      if (event === 'PASSWORD_RECOVERY') recovery.value = true
      if (event === 'SIGNED_OUT') recovery.value = false
      if (user.value?.id !== session?.user.id) {
        clearNuxtState('account-profile')
        clearNuxtState('profile-loaded-at')
      }
      user.value = session?.user ?? null
    })
  }
  return { provide: { supabase: client } }
} })
