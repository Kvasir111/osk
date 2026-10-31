import type { User } from '@supabase/supabase-js'
export function useAccount() {
  const user = useState<User | null>('account-user', () => null)
  const config = useRuntimeConfig().public
  const demo = !config.supabaseUrl || !config.supabasePublishableKey
  const client = useNuxtApp().$supabase
  async function api<T>(url: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> {
    const { data } = client ? await client.auth.getSession() : { data: { session: null } }
    return $fetch<T>(url, { ...options, body: options.body as Record<string, unknown> | FormData | undefined,
      headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} }) as Promise<T>
  }
  async function signOut() {
    if (client) await client.auth.signOut()
    clearNuxtState('product-search-jobs')
    clearNuxtState('wish-lists')
    clearNuxtState('wish-items')
    clearNuxtState('account-profile')
    clearNuxtState('profile-loaded-at')
    await navigateTo('/login')
  }
  return { user, demo, client, api, signOut }
}
