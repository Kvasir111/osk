import type { PriceObservation, WishItem } from './types'
import { bestOffer } from './pricing'

export function priceHistory(history: PriceObservation[], item: Pick<WishItem, 'name' | 'variant' | 'offers' | 'checked_at'>, now = new Date()) {
  // A name/variant edit starts a separate comparison; manual prices stay out of sale claims.
  const points = history.filter(h => h.name === item.name && h.variant === item.variant && h.source === 'search' && bestOffer(h.offers))
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
  const today = now.toISOString().slice(0, 10)
  const cutoff = now.getTime() - 30 * 86400000
  const days = new Map<string, number>()
  for (const h of points) {
    const day = h.observed_at.slice(0, 10)
    if (day < today && new Date(h.observed_at).getTime() >= cutoff) {
      const price = bestOffer(h.offers)!.price_cents
      days.set(day, Math.min(days.get(day) ?? Infinity, price))
    }
  }
  const daily = [...days.values()].sort((a, b) => a - b)
  const mid = Math.floor(daily.length / 2)
  const typical = daily.length >= 3 ? Math.round(daily.length % 2 ? daily[mid]! : (daily[mid - 1]! + daily[mid]!) / 2) : null
  const current = item.checked_at ? bestOffer(item.offers)?.price_cents : undefined
  const lowest = points.length ? Math.min(...points.map(h => bestOffer(h.offers)!.price_cents)) : null
  return { points, lowest, typical, days: days.size,
    belowTypical: typical && current && current < typical ? typical - current : null,
    isLowest: current !== undefined && lowest !== null && current <= lowest && points.length > 1 }
}
