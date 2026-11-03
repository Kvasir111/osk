import type { ProductDraft, WishItem } from './types'
import { bestOffer } from './pricing'

export function wishUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''; url.hostname = url.hostname.replace(/^www\./, '')
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|ref|ref_|tag|fbclid|gclid|affiliate|affid)$/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.href
  } catch { return '' }
}
function links(product: ProductDraft) {
  return [...product.offers.map(o => o.url), ...(product.notes.match(/https:\/\/[^\s<>"']+/g) || [])].map(wishUrl).filter(Boolean)
}
export function duplicateWishes(product: ProductDraft, items: WishItem[]) {
  const urls = new Set(links(product))
  const text = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return items.filter(item =>
    // A shared product page may expose several variants. Never merge them silently.
    (text(item.variant) === text(product.variant)) &&
    (links(item).some(url => urls.has(url)) || (!!text(product.name) && text(item.name) === text(product.name))))
}
export function filterWishes(items: WishItem[], options: { query: string; listId: string; category: string; status: string; min: string; max: string; priority: string }) {
  const words = options.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return items.filter(item => {
    const price = bestOffer(item.offers)?.price_cents
    const text = [item.name, item.variant, item.category, item.notes, item.gift_preferences, ...item.offers.map(o => o.retailer)].join(' ').toLocaleLowerCase()
    return (!options.listId || item.list_id === options.listId) &&
      (!options.category || item.category === options.category) &&
      (options.status === 'all' || (item.status || 'active') === options.status) &&
      (!options.priority || (item.priority || 'idea') === options.priority) &&
      words.every(word => text.includes(word)) &&
      (!options.min || (price !== undefined && price >= Math.round(Number(options.min) * 100))) &&
      (!options.max || (price !== undefined && price <= Math.round(Number(options.max) * 100)))
  })
}

// JSONB property order differs from browser objects; compare a canonical projection.
export function priceEvidenceChanged(previous: ProductDraft, next: ProductDraft) {
  const evidence = (product: ProductDraft) => [product.name, product.variant, product.msrp_cents, product.msrp_source_url,
    product.offers.map(o => [o.retailer,o.url,o.price_cents,o.seller_type,o.us_shipping,o.availability,o.shipping_note])]
  return JSON.stringify(evidence(previous)) !== JSON.stringify(evidence(next))
}
