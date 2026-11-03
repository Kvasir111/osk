import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshItem } from '../../server/utils/refresh-prices'
import { searchProducts } from '../../server/utils/product-search'
import { scrapeProducts } from '../../server/utils/product-scraper'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ProductPageError } from '../../server/utils/product-page-errors'
vi.mock('../../server/utils/product-search', () => ({ searchProducts: vi.fn() }))
vi.mock('../../server/utils/product-scraper', async original => ({ ...await original<typeof import('../../server/utils/product-scraper')>(), scrapeProducts: vi.fn() }))
const product = { last_attempt_at:'2026-11-03T12:00:00Z', name: 'Exact product', variant: 'Black', category: 'Tech', notes: '', msrp_cents: 10000, msrp_source_url: 'https://example.com/msrp', offers: [{ url: 'https://example.com/product' }] }
const update = vi.fn()
const select = vi.fn()
const eq = vi.fn()
const query = {eq,select}
const db = { rpc: vi.fn(), from: vi.fn(() => ({ update: (data: unknown) => { update(data); return query } })) } as unknown as SupabaseClient
beforeEach(() => { vi.clearAllMocks(); eq.mockReturnValue(query); select.mockResolvedValue({data:[{id:'id'}],error:null}); vi.stubEnv('PRODUCT_RESEARCH_MODE','ai'); vi.mocked(db.rpc).mockResolvedValue({ data: [product], error: null } as any) })
afterEach(() => vi.unstubAllEnvs())
describe('Daily refresh behavior', () => {
  it('uses scraping by default even with an existing OpenAI key', async () => {
    vi.stubEnv('PRODUCT_RESEARCH_MODE', '')
    vi.stubEnv('OPENAI_API_KEY', 'test-only-existing-key')
    vi.mocked(scrapeProducts).mockResolvedValue({ products: [product], checked_at: 'now', sources: [], summary: '' } as any)
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('ok')
    expect(scrapeProducts).toHaveBeenCalledWith(expect.arrayContaining(['https://example.com/product']), product)
    expect(searchProducts).not.toHaveBeenCalled()
  })
  it('retains previous prices when saved pages are blocked without falling back to AI', async () => {
    vi.stubEnv('PRODUCT_RESEARCH_MODE', 'scrape')
    vi.mocked(scrapeProducts).mockResolvedValue({ products: [], checked_at: 'now', sources: [], summary: '', warnings: ['Page blocked'], retailer_checks: [] })
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('failed')
    expect(update.mock.calls[0]![0]).not.toHaveProperty('offers')
    expect(searchProducts).not.toHaveBeenCalled()
  })
  it('explains missing links without discarding manually entered prices', async () => {
    vi.stubEnv('PRODUCT_RESEARCH_MODE', 'scrape')
    vi.mocked(scrapeProducts).mockRejectedValue(new ProductPageError('no_links'))
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('failed')
    expect(update.mock.calls[0]![0].price_check_details.warnings[0]).toContain('Add a store')
    expect(update.mock.calls[0]![0]).not.toHaveProperty('offers')
    expect(searchProducts).not.toHaveBeenCalled()
  })
  it('preserves prices when a search fails', async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error('Timeout'))
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('failed')
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ refresh_status: 'failed', price_check_details: expect.objectContaining({ warnings: expect.any(Array) }) }))
  })
  it('rejects different variants and keeps the previous offers', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ products: [{ ...product, variant: 'White' }], checked_at: 'now', sources: [], summary: '' } as any)
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('failed')
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ refresh_status: 'failed', price_check_details: expect.objectContaining({ warnings: expect.any(Array) }) }))
  })
  it('updates exact-match offers and retains the original MSRP baseline', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ products: [{ ...product, msrp_cents: 20000 }], checked_at: 'now', sources: [], summary: '' } as any)
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('ok')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ msrp_cents: 10000, msrp_source_url: product.msrp_source_url, checked_at: 'now', refresh_status: 'ok' }))
  })
  it('checks saved unpriced links and retains them when a partial result misses that store', async () => {
    const amazon = 'https://www.amazon.com/dp/B0DVC217X9'
    vi.mocked(db.rpc).mockResolvedValue({ data: [{ ...product, price_check_details: { warnings: [], retailer_checks: [{ retailer: 'Amazon', url: amazon, note: 'Price blocked' }] } }], error: null } as any)
    vi.mocked(searchProducts).mockResolvedValue({ products: [product], checked_at: 'now', sources: [], summary: '' } as any)
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('ok')
    expect(searchProducts).toHaveBeenCalledWith(expect.stringContaining(amazon), expect.anything())
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ price_check_details: expect.objectContaining({ retailer_checks: expect.arrayContaining([expect.objectContaining({ retailer: 'Amazon', url: amazon })]) }) }))
  })
  it('does not overwrite a newer manual edit or an archived wish after fetching', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ products:[product], checked_at:'now', sources:[], summary:'' } as any)
    select.mockResolvedValue({data:[],error:null})
    expect(await refreshItem(db,'id','cutoff')).toBe('skipped')
    expect(eq).toHaveBeenCalledWith('last_attempt_at',product.last_attempt_at)
    expect(eq).toHaveBeenCalledWith('status','active')
  })
  it('skips already-leased items without making an OpenAI call', async () => {
    vi.mocked(db.rpc).mockResolvedValue({ data: [], error: null } as any)
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('skipped')
    expect(searchProducts).not.toHaveBeenCalled()
  })
})
