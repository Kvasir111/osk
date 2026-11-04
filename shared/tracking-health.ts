import type { WishItem } from './types'
import { trackingLinks } from './tracking'
export type TrackingHealth = 'fresh'|'stale'|'failed'|'never'|'missing'|'paused'|'pending'
export const healthLabels: Record<TrackingHealth,string> = {fresh:'Fresh',stale:'Stale',failed:'Check failed',never:'Not checked',missing:'Missing links',paused:'Paused',pending:'Waiting to sync'}
export function trackingHealth(item: WishItem, now=Date.now()):TrackingHealth {
  if (item.status && item.status!=='active') return 'paused'
  if (item.pending_sync) return 'pending'
  if (!trackingLinks(item).length) return 'missing'
  if (item.refresh_status==='failed') return 'failed'
  if (!item.checked_at || item.refresh_status==='never') return 'never'
  const checked=Date.parse(item.checked_at)
  return !Number.isFinite(checked) || now-checked>36*3600000 ? 'stale':'fresh'
}
export function trackingReason(item:WishItem) {
  if (item.status && item.status!=='active') return 'Received and archived wishes keep their history; checks are paused.'
  if (item.pending_sync) return 'Sync this wish before checking its prices or setting a target.'
  if (!trackingLinks(item).length) return 'Add an exact product link so daily checks have a page to read.'
  if (item.refresh_status==='never') return 'Manual prices are saved. A successful check is still needed.'
  return item.price_check_details?.warnings?.[0] || (item.refresh_status==='failed'?'No current price could be verified. Previous offers were kept.':'Checks revisit your saved links; they do not discover other stores.')
}
