import type { ProductDraft, WishItem } from './types'
import { publicUrl } from './validation'
export function trackingLinks(item: WishItem) {
  return [...new Set([...item.offers.map(offer => offer.url), ...(item.price_check_details?.retailer_checks || []).map(check => check.url), item.msrp_source_url,
    ...(item.notes.match(/https:\/\/[^\s<>"']+/g) || [])])].filter((url): url is string => !!url && publicUrl.safeParse(url).success).slice(0, 20)
}
export function repairProduct(item: WishItem, detected: ProductDraft, previousUrl: string, selectedUrl: string): ProductDraft {
  const same = item.name === detected.name && item.variant === detected.variant
  // A changed identity cannot inherit offers or MSRP observations for the old variant.
  const offers = same ? [...item.offers.filter(offer => offer.url !== previousUrl && offer.url !== selectedUrl), ...detected.offers] : detected.offers
  const remaining = same ? trackingLinks(item).filter(url => url !== previousUrl && url !== selectedUrl) : []
  const notes = item.notes.replace(/https:\/\/[^\s<>"']+/g, url => url === previousUrl ? selectedUrl : url)
  const links = [...new Set([...remaining, selectedUrl])].filter(url => !notes.includes(url))
  return { ...detected, category: item.category, notes: [notes, ...links.map(url => `Product link: ${url}`)].filter(Boolean).join('\n'), offers,
    msrp_cents: same ? item.msrp_cents ?? detected.msrp_cents : detected.msrp_cents,
    msrp_source_url: same && item.msrp_cents ? item.msrp_source_url : detected.msrp_source_url,
    image_mode: item.image_mode || 'auto', image_url: item.image_mode === 'custom' || item.image_mode === 'none' ? item.image_url : same ? item.image_url || detected.image_url : detected.image_url,
    image_source_url: item.image_mode === 'custom' || item.image_mode === 'none' ? item.image_source_url : same ? item.image_source_url || detected.image_source_url : detected.image_source_url }
}
export function comparisonSearch(name: string, variant: string) {
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('tbm', 'shop'); url.searchParams.set('q', `${name} ${variant}`.trim()); url.searchParams.set('gl', 'us')
  return url.href
}
