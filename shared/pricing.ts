import type { Offer, ProductDraft } from './types'
export const money = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
}).format(cents / 100)
export function bestOffer(offers: Offer[]) {
  return [...offers].sort((a, b) => a.price_cents - b.price_cents)[0]
}
export function savings(product: Pick<ProductDraft, 'offers' | 'msrp_cents'>) {
  const best = bestOffer(product.offers)
  if (!best || !product.msrp_cents || best.price_cents >= product.msrp_cents) return null
  return { cents: product.msrp_cents - best.price_cents,
    percent: Math.round((1 - best.price_cents / product.msrp_cents) * 100) }
}
