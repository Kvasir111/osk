import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshItem } from '../../server/utils/refresh-prices'
import { searchProducts } from '../../server/utils/product-search'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('../../server/utils/product-search', () => ({ searchProducts: vi.fn() }))
const product = { name: 'Exact product', variant: 'Black', category: 'Tech', notes: '', msrp_cents: 10000, msrp_source_url: 'https://example.com/msrp', offers: [{ url: 'https://example.com/product' }] }
const update = vi.fn()
const db = { rpc: vi.fn(), from: vi.fn(() => ({ update: (data: unknown) => { update(data); return { eq: vi.fn().mockResolvedValue({ error: null }) } } })) } as unknown as SupabaseClient
beforeEach(() => { vi.clearAllMocks(); vi.mocked(db.rpc).mockResolvedValue({ data: [product], error: null } as any) })
describe('Daily refresh behavior', () => {
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
  it('skips already-leased items without making an OpenAI call', async () => {
    vi.mocked(db.rpc).mockResolvedValue({ data: [], error: null } as any)
    expect(await refreshItem(db, 'id', 'cutoff')).toBe('skipped')
    expect(searchProducts).not.toHaveBeenCalled()
  })
})
