import type { WishItem, WishList } from './types'
import type { PendingAddition } from '../app/utils/offline-storage'

export function overlayAdditions(lists: WishList[], items: WishItem[], additions: PendingAddition[]) {
  const listMap = new Map(lists.map(list => [list.id, list]))
  const itemMap = new Map(items.map(item => [item.id, item]))
  for (const addition of additions) {
    if (addition.kind === 'list') {
      if (!listMap.has(addition.id)) listMap.set(addition.id, { ...addition.product, id: addition.id, owner_id: addition.accountId, share_token: null, created_at: addition.createdAt, pending_sync: true })
    } else if (!itemMap.has(addition.id)) itemMap.set(addition.id, { ...addition.product, id: addition.id, list_id: addition.listId, created_at: addition.createdAt, checked_at: null, last_attempt_at: null, refresh_status: 'never', pending_sync: true })
  }
  return { lists: [...listMap.values()], items: [...itemMap.values()] }
}
export function syncProblem(status: number) {
  if (status === 401) return 'Sign in again with this account to sync your additions.'
  if (status === 403) return 'You no longer have permission to add to this list.'
  if (status === 404) return 'This list is no longer available.'
  return 'This addition could not be synced. Review it, then retry or remove the local copy.'
}
