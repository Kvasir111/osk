import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductDraft } from '../../shared/types'

const { create, parse } = vi.hoisted(() => ({ create: vi.fn(), parse: vi.fn() }))
vi.mock('openai', () => ({ default: class { responses = { create, parse } } }))
import { searchProducts } from '../../server/utils/product-search'

const product: ProductDraft = { name: 'Example product', variant: 'Blue, 40 servings', category: 'Other', notes: '',
  msrp_cents: 6000, msrp_source_url: 'https://manufacturer.example/product',
  offers: [
    { retailer: 'Brand', url: 'https://manufacturer.example/product', price_cents: 6000, seller_type: 'manufacturer', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' },
    { retailer: 'Amazon', url: 'https://amazon.com/dp/B0DVC217X9', price_cents: 5000, seller_type: 'marketplace', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' },
    { retailer: 'Another retailer', url: 'https://retailer.example/product', price_cents: 5500, seller_type: 'retailer', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' },
  ] }
const research = (url: string) => ({ status: 'completed', output_text: 'Sourced exact-variant findings', output: [
  { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url, title: 'Product page' }] }] },
] })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('PRODUCT_RESEARCH_MODE','ai')
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key')
  create.mockImplementation(async request => request.tools[0].filters ? research(product.offers[1]!.url)
    : request.instructions.includes('YOUR ASSIGNMENT: Search independent') ? research(product.offers[2]!.url) : research(product.offers[0]!.url))
  parse.mockResolvedValue({ status: 'completed', output_parsed: { summary: 'Matches found.', products: [product], retailer_checks: [] } })
})
afterEach(() => vi.unstubAllEnvs())
describe('Retailer research coverage', () => {
  it('combines independent research evidence instead of keeping only the manufacturer', async () => {
    const result = await searchProducts('Example product, blue, 40 servings')
    expect(result.products[0]?.offers.map(offer => offer.retailer)).toEqual(['Brand', 'Amazon', 'Another retailer'])
    expect(result.warnings).toEqual([])
    expect(result.retailer_checks).toEqual([])
    expect(create.mock.calls.some(([request]) => request.tools[0].filters?.allowed_domains.includes('amazon.com'))).toBe(true)
  })
  it('keeps partial results and explicitly reports unfinished Amazon research', async () => {
    create.mockImplementation(async request => {
      if (request.tools[0].filters) throw new Error('Search timed out')
      return research(product.offers[0]!.url)
    })
    const result = await searchProducts('Example product')
    expect(result.products[0]?.offers).toHaveLength(1)
    expect(result.warnings?.some(warning => warning.includes('Amazon search could not finish'))).toBe(true)
    expect(result.warnings?.some(warning => warning.includes('0 of 2'))).toBe(true)
    expect(result.retailer_checks).toEqual([expect.objectContaining({ retailer: 'Amazon', url: null })])
  })
  it('does not expose invented links for unpriced listings', async () => {
    parse.mockResolvedValue({ status: 'completed', output_parsed: { summary: '', products: [product],
      retailer_checks: [{ retailer: 'Unknown store', url: 'https://invented.example/product', note: 'Price unavailable' }] } })
    const result = await searchProducts('Example product')
    expect(result.retailer_checks?.[0]?.url).toBeNull()
  })
  it('fails when all research fails, instead of presenting fabricated results', async () => {
    create.mockRejectedValue(new Error('Provider unavailable'))
    await expect(searchProducts('Example product')).rejects.toThrow('did not complete')
    expect(parse).not.toHaveBeenCalled()
  })
})
