import { lastOfflineIdentity } from '../utils/offline-storage'
import { createClient } from '@supabase/supabase-js'
import type { User, SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin({ name: 'supabase', async setup() {
  const config = useRuntimeConfig().public
  const user = useState<User | null>('account-user', () => null)
  const client: SupabaseClient | null = config.supabaseUrl && config.supabasePublishableKey
    ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null
  if (client) {
    if (navigator.onLine) {
      const { data } = await client.auth.getSession()
      user.value = data.session?.user ?? null
    } else {
      client.auth.stopAutoRefresh()
      // Cached identity is only for this device's offline UI, never server authorization.
      user.value = await lastOfflineIdentity().catch(() => undefined) as User || null
    }
    client.auth.onAuthStateChange((_event, session) => {
      if (!navigator.onLine && !session) return
      if (user.value?.id !== session?.user.id) {
        clearNuxtState('account-profile')
        clearNuxtState('profile-loaded-at')
      }
      user.value = session?.user ?? null
    })
  }
  return { provide: { supabase: client } }
} })
