import { createClient } from '@supabase/supabase-js'
import type { User, SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig().public
  const user = useState<User | null>('account-user', () => null)
  const client: SupabaseClient | null = config.supabaseUrl && config.supabasePublishableKey
    ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null
  if (client) {
    const { data } = await client.auth.getSession()
    user.value = data.session?.user ?? null
    client.auth.onAuthStateChange((_event, session) => {
      if (user.value?.id !== session?.user.id) {
        clearNuxtState('account-profile')
        clearNuxtState('profile-loaded-at')
      }
      user.value = session?.user ?? null
    })
  }
  return { provide: { supabase: client } }
})
