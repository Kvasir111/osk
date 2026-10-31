import type { ProductDraft } from './types'

export function retailerDomain(value: string) {
  const host = new URL(value).hostname.toLowerCase().replace(/^(www|m|smile)\./, '')
  if (host === 'amazon.com' || host.endsWith('.amazon.com')) return 'amazon.com'
  return host
}

export function retailerCount(product: Pick<ProductDraft, 'offers' | 'msrp_source_url'>) {
  const manufacturer = product.msrp_source_url ? retailerDomain(product.msrp_source_url) : null
  return new Set(product.offers.filter(offer => offer.seller_type !== 'manufacturer' &&
    retailerDomain(offer.url) !== manufacturer).map(offer => retailerDomain(offer.url))).size
}
