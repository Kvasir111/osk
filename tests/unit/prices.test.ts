import { describe, expect, it } from 'vitest'
import { savings, bestOffer } from '../../shared/pricing'
import { productSchema } from '../../shared/validation'
import { retainSourcedProducts } from '../../server/utils/product-search'
import type { Offer, ProductDraft } from '../../shared/types'
import { retailerCount } from '../../shared/retailers'
const offer: Offer = { retailer: 'Manufacturer', url: 'https://example.com/product', price_cents: 4999, seller_type: 'manufacturer', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' }
const product: ProductDraft = { name: 'Exact product', variant: 'Black', category: 'Tech', msrp_cents: 6999, msrp_source_url: 'https://example.com/msrp', offers: [offer], notes: '' }
describe('Price accuracy and evidence', () => {
  it('compares integer cents to MSRP, not another store price', () => {
    expect(savings(product)).toEqual({ cents: 2000, percent: 29 })
    expect(savings({ ...product, msrp_cents: null })).toBeNull()
    expect(savings({ ...product, msrp_cents: 3999 })).toBeNull()
    expect(savings({ ...product, offers: [] })).toBeNull()
  })
  it('sorts offers without mutating saved order', () => {
    const offers = [{ ...offer, price_cents: 8000 }, offer]
    expect(bestOffer(offers)?.price_cents).toBe(4999)
    expect(offers[0]?.price_cents).toBe(8000)
  })
  it('requires an MSRP source and safe HTTPS retailer links', () => {
    expect(productSchema.safeParse({ ...product, msrp_source_url: null }).success).toBe(false)
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://localhost/a', 'https://127.0.0.1/a', 'https://user:pass@example.com']) {
      expect(productSchema.safeParse({ ...product, offers: [{ ...offer, url }] }).success).toBe(false)
    }
  })
  it('drops unsourced offers and unknown MSRP instead of inventing evidence', () => {
    expect(retainSourcedProducts([product], []).at(0)).toMatchObject({ offers: [], msrp_cents: null, msrp_source_url: null })
    expect(retainSourcedProducts([product], [{ url: offer.url }]).at(0)).toMatchObject({ offers: [offer], msrp_cents: null })
    expect(retainSourcedProducts([product], [{ url: offer.url }, { url: product.msrp_source_url! }]).at(0)).toEqual(product)
  })
  it('accepts matching source URLs that differ only by tracking, not variant selectors', () => {
    const tracked = { ...product, offers: [{ ...offer, url: 'https://www.example.com/product?variant=blue&utm_source=openai' }] }
    expect(retainSourcedProducts([tracked], [{ url: 'https://example.com/product?variant=blue' }])[0]?.offers).toHaveLength(1)
    expect(retainSourcedProducts([tracked], [{ url: 'https://example.com/product?variant=red' }])[0]?.offers).toHaveLength(0)
  })
  it('matches Amazon ASIN links while preserving seller identity', () => {
    const amazon = { ...product, offers: [{ ...offer, url: 'https://www.amazon.com/Product-name/dp/B0DVC217X9/ref=sr_1_1?smid=SELLER1&utm_source=openai' }] }
    expect(retainSourcedProducts([amazon], [{ url: 'https://amazon.com/dp/B0DVC217X9?smid=SELLER1' }])[0]?.offers).toHaveLength(1)
    expect(retainSourcedProducts([amazon], [{ url: 'https://amazon.com/dp/B0DVC217X9?smid=SELLER2' }])[0]?.offers).toHaveLength(0)
  })
  it('matches a user-shared Amazon URL without losing seller selectors', () => {
    const shared = { ...product, offers: [{ ...offer, url: 'https://www.amazon.com/dp/B0DVC217X9?lv=shuf&channelId=500&plpRedirect=mhFallback' }] }
    expect(retainSourcedProducts([shared], [{ url: 'https://www.amazon.com/dp/B0DVC217X9' }])[0]?.offers).toHaveLength(1)
    const seller = { ...shared, offers: [{ ...shared.offers[0]!, url: shared.offers[0]!.url + '&smid=SELLER1' }] }
    expect(retainSourcedProducts([seller], [{ url: 'https://www.amazon.com/dp/B0DVC217X9?smid=SELLER2' }])[0]?.offers).toHaveLength(0)
  })
  it('keeps valid offers when a different extracted offer is malformed', () => {
    const malformed = { ...product, offers: [offer, { ...offer, url: 'not a URL' }] }
    expect(retainSourcedProducts([malformed], [{ url: offer.url }])[0]?.offers).toEqual([offer])
  })
  it('counts distinct retailer websites beyond the manufacturer, not duplicate offers', () => {
    expect(retailerCount(product)).toBe(0)
    expect(retailerCount({ ...product, offers: [offer,
      { ...offer, seller_type: 'marketplace', url: 'https://www.amazon.com/dp/B0DVC217X9' },
      { ...offer, seller_type: 'marketplace', url: 'https://amazon.com/dp/B000000001' },
      { ...offer, seller_type: 'retailer', url: 'https://www.gnc.com/product' },
    ] })).toBe(2)
    expect(retailerCount({ ...product, offers: [{ ...offer, seller_type: 'retailer' }] })).toBe(0)
  })
})
