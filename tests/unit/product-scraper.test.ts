import { describe, expect, it, vi } from 'vitest'
import { parseProductPage, priceCents, savedProductUrls, scrapeProducts } from '../../server/utils/product-scraper'
import type { WishItem } from '../../shared/types'
import { ProductPageError, productPageFailure } from '../../server/utils/product-page-errors'
const url = 'https://shop.example.com/mug'
const node = { '@type': 'Product', name: 'Ceramic mug', color: 'Blue', url, image: 'https://shop.example.com/mug.jpg', offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url } }
const html = (value: unknown) => `<title>Ceramic mug Blue</title><script type="application/ld+json">${JSON.stringify(value)}</script>`
const expected = { name: 'Ceramic mug', variant: 'Blue', category: 'Home', notes: '', msrp_cents: null, msrp_source_url: null, offers: [] }
describe('Direct product-page metadata', () => {
  it('extracts exact USD cents, variant, listing evidence, and picture without inventing MSRP or shipping', () => {
    const found = parseProductPage(html(node), url).product
    expect(found.name).toBe('Ceramic mug')
    expect(found.variant).toBe('Blue')
    expect(found.offers[0]).toMatchObject({ url, price_cents: 1999, availability: 'in_stock', us_shipping: 'unknown' })
    expect(found.msrp_cents).toBeNull()
    expect(found.image_url).toBe(node.image)
  })
  it('accepts MSRP only explicitly labeled on an identified manufacturer page', () => {
    const product = { ...node, offers: { ...node.offers, priceSpecification: { priceType: 'https://schema.org/MSRP', price: '29.99', priceCurrency: 'USD' } } }
    expect(parseProductPage(html(product), url).product.msrp_cents).toBeNull()
    expect(parseProductPage(html({ ...product, manufacturer: { url: 'https://shop.example.com' } }), url).product.msrp_cents).toBe(2999)
  })
  it('rejects aggregate ranges, non-USD, missing currencies, used, out-of-stock, expired, and conditional offers', () => {
    const cases = [
      { '@type': 'AggregateOffer', lowPrice: '10.00', highPrice: '20.00', priceCurrency: 'USD' },
      { ...node.offers, priceCurrency: 'EUR' }, { ...node.offers, priceCurrency: undefined },
      { ...node.offers, availability: 'https://schema.org/OutOfStock' },
      { ...node.offers, itemCondition: 'https://schema.org/UsedCondition' },
      { ...node.offers, priceValidUntil: '2000-01-01' },
      { ...node.offers, priceSpecification: { billingDuration: 'P1M' } },
      { ...node.offers, validForMemberTier: 'Members' },
    ]
    for (const offer of cases) expect(parseProductPage(html({ ...node, offers: offer }), url).product.offers).toEqual([])
  })
  it('does not substitute another selected variant or another offer URL', () => {
    expect(parseProductPage(html(node), url + '?variant=red').product.offers).toEqual([])
    expect(parseProductPage(html({ ...node, offers: { ...node.offers, url: url + '?variant=red' } }), url).product.offers).toEqual([])
    expect(() => parseProductPage(html([node, { ...node, url: url + '-other' }]), url + '?variant=red')).toThrow('multiple')
  })
  it('requires exact saved identity and marketplace seller evidence', () => {
    expect(() => parseProductPage(html(node), url, { ...expected, variant: 'Red' })).toThrow('variant')
    expect(() => parseProductPage(html({ ...node, color: 'M' }), url, { ...expected, variant: 'S' })).toThrow('variant')
    expect(() => parseProductPage(html({ ...node, color: 'XS' }), url, { ...expected, variant: 'XL' })).toThrow('variant')
    const amazon = 'https://www.amazon.com/dp/B000000001'
    const item = { ...node, url: amazon, offers: { ...node.offers, url: amazon } }
    expect(parseProductPage(html(item), amazon).product.offers).toEqual([])
    expect(parseProductPage(html({ ...item, offers: { ...item.offers, seller: { name: 'Unknown' } } }), amazon).product.offers).toEqual([])
    expect(parseProductPage(html({ ...item, offers: { ...item.offers, seller: { name: 'Example Store' } } }), amazon).product.offers[0]?.seller_type).toBe('marketplace')
  })
  it('accepts product Open Graph metadata but not generic category-page prices', () => {
    const meta = '<meta property="og:type" content="product"><meta property="og:title" content="A book"><meta property="product:price:amount" content="12.50"><meta property="product:price:currency" content="USD">'
    expect(parseProductPage(meta, 'https://shop.example.com/book').product.offers[0]?.price_cents).toBe(1250)
    expect(() => parseProductPage(meta, 'https://shop.example.com/collections/books')).toThrow('individual')
  })
  it('reads Rogue-shaped groups without assigning a default color or starting price', () => {
    const base = 'https://www.roguefitness.com/rogue-ohio-lifting-straps'
    const black = { ...node, name: 'Rogue Ohio Lifting Straps - Black', color: 'Black', sku: 'RA0740', url: base + '?sku=RA0740', image: base + '.jpg', offers: [{ ...node.offers, url: undefined, price: '14' }] }
    const red = { ...black, name: 'Rogue Ohio Lifting Straps', color: 'Red', sku: 'SH0021-Red', url: base + '?sku=SH0021-Red', image: base + '-red.jpg', offers: [{ ...node.offers, url: undefined, price: '18' }] }
    const group = { '@type': 'ProductGroup', name: 'Rogue Ohio Lifting Straps', url: base, color: 'Black', offers: black.offers, hasVariant: [black, red] }
    const found = parseProductPage(html(group), base)
    expect(found.product).toMatchObject({ name: group.name, variant: '', offers: [], msrp_cents: null })
    expect(found.variants).toHaveLength(2)
    expect(found.variants?.[1]).toEqual({ label: 'Rogue Ohio Lifting Straps · Red · SH0021-Red', url: red.url })
    expect(parseProductPage(html(group), red.url).product).toMatchObject({ variant: 'Red', image_url: red.image, offers: [{ price_cents: 1800, url: red.url }] })
    // The actual selected Rogue page canonicalizes SKU casing; other stores remain case-sensitive.
    expect(parseProductPage(html({ ...red, url: base + '?sku=sh0021-red' }), red.url).product.offers[0]?.price_cents).toBe(1800)
    expect(parseProductPage(html({ ...node, url: url + '?sku=red' }), url + '?sku=Red').product.offers).toEqual([])
    expect(parseProductPage(html(group), base + '?sku=unpublished').product.offers).toEqual([])
    expect(() => parseProductPage(html(group), base, { ...expected, name: group.name, variant: 'Red' })).toThrow('variant')
  })
  it('preserves full rack configuration URLs and ignores unrelated or unsafe option links', async () => {
    const base = 'https://www.roguefitness.com/rogue-fm-6-twin-functional-trainer'
    const name = 'Rogue FM-6 Twin Functional Trainer'
    const blue = { ...node, name, color: 'Bright Blue', sku: 'RF0999-BLUE', url: base + '?b=1130914-1139452-3698', offers: [{ ...node.offers, url: undefined, price: '5940' }] }
    const black = { ...blue, color: 'Textured Black', sku: 'RF0999-BLACK', url: base + '?b=1131004-1139452-3698', image: undefined, offers: [{ ...node.offers, url: undefined, price: '5747' }] }
    const group = { '@type': 'ProductGroup', name, url: base + '?sku=FM-6-Twin-Bundle', color: 'Various Colors', offers: blue.offers, hasVariant: [blue, black,
      { ...blue, url: 'https://localhost/private' }, { ...blue, url: 'https://other.example.com/rack' }, { ...blue, url: base + '-other' }, { ...blue },
    ] }
    const found = parseProductPage(html(group), base)
    expect(found.product.offers).toEqual([])
    expect(found.variants).toHaveLength(2)
    expect(parseProductPage(html(group), black.url).product).toMatchObject({ name, variant: 'Textured Black', image_url: null, offers: [{ url: black.url, price_cents: 574700 }] })
    expect(parseProductPage(html(group), base + '?b=unknown').product.offers).toEqual([])
    const reader = vi.fn().mockResolvedValue({ html: html(group), url: base })
    expect((await scrapeProducts([base], undefined, reader)).variants).toEqual(found.variants)
    expect(reader).toHaveBeenCalledTimes(1)
  })
  it('confirms Rogue default SKU metadata without accepting another color or configuration', () => {
    const base = 'https://www.roguefitness.com/rogue-ohio-lifting-straps'
    const selected = base + '?sku=RA0740'
    const black = { ...node, name: 'Rogue Ohio Lifting Straps - Black', color: 'Black', sku: 'RA0740', url: base, offers: [{ ...node.offers, url: undefined, price: '15' }] }
    expect(parseProductPage(html(black), selected).product.offers[0]).toMatchObject({ url: selected, price_cents: 1500 })
    expect(parseProductPage(html(black), selected + '&utm_source=test').product.offers).toHaveLength(1)
    for (const query of ['?sku=SH0021-Red', '?sku=RA0740&b=another', '?sku=RA0740&sku=SH0021-Red']) {
      expect(parseProductPage(html(black), base + query).product.offers).toEqual([])
    }
    expect(() => parseProductPage(html(black), selected, { ...expected, name: 'Rogue Ohio Lifting Straps', variant: 'Red' })).toThrow('variant')
    expect(parseProductPage(html({ ...node, sku: 'RA0740' }), url + '?sku=RA0740').product.offers).toEqual([])
  })
  it('preserves useful failure reasons without exposing raw network errors', async () => {
    const found = await scrapeProducts([url], { ...expected, variant: 'Red' }, vi.fn().mockResolvedValue({ html: html(node), url }))
    expect(found.retailer_checks?.[0]?.note).toContain('name and variant')
    for (const reason of ['blocked', 'unavailable', 'metadata', 'redirected'] as const) {
      const result = await scrapeProducts([url], expected, vi.fn().mockRejectedValue(new ProductPageError(reason)))
      expect(result.retailer_checks?.[0]?.note).toBe(productPageFailure(new ProductPageError(reason)))
    }
    expect(productPageFailure(new DOMException('unsafe detail', 'AbortError'))).toContain('time limit')
    expect(productPageFailure(new Error('credential or internal hostname'))).not.toMatch(/credential|internal hostname/)
    expect(() => parseProductPage('<title>Robot Check</title>', url)).toThrow('blocked automated access')
  })
  it('only accepts bounded, exact positive cents', () => {
    for (const value of ['19,99', '$19.99', '1e3', '19.999', '-1', '0', '1000000.01']) expect(priceCents(value)).toBeNull()
    expect(priceCents('0.01')).toBe(1)
    expect(priceCents('19.9')).toBe(1990)
  })
  it('keeps URLs from priced offers, unpriced checks, and captured notes for daily checks', () => {
    expect(savedProductUrls({ ...expected, notes: `Product link: ${url}\nProduct link: https://third.example.com/mug`, offers: [{ url: 'https://other.example.com/mug' }], price_check_details: { retailer_checks: [{ url }], warnings: [] } } as unknown as WishItem)).toEqual(['https://other.example.com/mug', url, 'https://third.example.com/mug'])
  })
  it('preserves failed listing evidence and never fetches private or invalid URLs', async () => {
    const reader = vi.fn().mockRejectedValue(new Error('blocked'))
    const found = await scrapeProducts([url, 'https://localhost/private', 'http://shop.example.com/mug'], expected, reader)
    expect(reader).toHaveBeenCalledTimes(1)
    expect(found.products).toEqual([])
    expect(found.retailer_checks?.[0]?.url).toBe(url)
  })
})
