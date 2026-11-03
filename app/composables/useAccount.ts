import { clearOfflineAccount, readOfflineAccount, withOfflineLock } from '../utils/offline-storage'
import type { User } from '@supabase/supabase-js'
export function useAccount() {
  const user = useState<User | null>('account-user', () => null)
  const config = useRuntimeConfig().public
  const demo = !config.supabaseUrl || !config.supabasePublishableKey
  const client = useNuxtApp().$supabase
  async function api<T>(url: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; accountId?: string; timeout?: number } = {}): Promise<T> {
    if (import.meta.client && !navigator.onLine) throw new Error('This action needs a connection. Your offline additions are kept on this device.')
    const { data } = client ? await client.auth.getSession() : { data: { session: null } }
    const { accountId, ...request } = options
    if (accountId && data.session?.user.id !== accountId) throw Object.assign(new Error('Sign in again with the account that saved these wishes.'), { statusCode: 401 })
    return $fetch<T>(url, { ...request, body: request.body as Record<string, unknown> | FormData | undefined,
      headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} }) as Promise<T>
  }
  async function signOut() {
    const account = user.value?.id
    if (account && !demo) {
      const queued = await readOfflineAccount(account).catch(() => ({ additions: [] }))
      if (queued.additions.length && !confirm(`You have ${queued.additions.length} unsynced additions on this device. Signing out will remove them. Sign out anyway?`)) return
      // Change identity before waiting on locks, so in-flight sync cannot write the cache back.
      user.value = null
      await withOfflineLock(account, () => clearOfflineAccount(account))
    }
    if (client) {
      if (navigator.onLine) await client.auth.signOut()
      else {
        client.auth.stopAutoRefresh()
        const key = `sb-${new URL(config.supabaseUrl).hostname.split('.')[0]}-auth-token`
        localStorage.removeItem(key); localStorage.removeItem(`${key}-code-verifier`)
        void client.auth.signOut({ scope: 'local' }).catch(() => {})
      }
    }
    clearNuxtState('offline-pending'); clearNuxtState('offline-owner'); clearNuxtState('wish-roles'); clearNuxtState('wish-loaded'); clearNuxtState('active-list')
    clearNuxtState('product-search-jobs')
    clearNuxtState('wish-lists')
    clearNuxtState('wish-items')
    clearNuxtState('account-profile')
    clearNuxtState('profile-loaded-at')
    await navigateTo('/login')
  }
  return { user, demo, client, api, signOut }
}
