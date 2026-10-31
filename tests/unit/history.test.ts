import { describe, expect, it } from 'vitest'
import { priceHistory } from '../../shared/history'
import { captureUrl, captureQuery } from '../../shared/capture'
import type { Offer, PriceObservation } from '../../shared/types'
const offer: Offer = { retailer: 'Shop', url: 'https://example.com/item', price_cents: 1000, seller_type: 'retailer', us_shipping: 'unknown', availability: 'unknown', shipping_note: '' }
const now = new Date('2026-10-30T12:00:00Z')
const item = { name: 'Book', variant: 'Hardcover', offers: [{ ...offer, price_cents: 700 }], checked_at: now.toISOString() }
const row = (day: number, price: number, extra: Partial<PriceObservation> = {}): PriceObservation => ({ id: String(day), item_id: 'item', name: item.name, variant: item.variant, source: 'search', observed_at: `2026-10-${day}T10:00:00Z`, offers: [{ ...offer, price_cents: price }], msrp_cents: 2000, ...extra })
describe('Observed sale context', () => {
  it('requires three distinct prior days, excluding today and manual entries', () => {
    const result = priceHistory([row(28, 1000), row(28, 900), row(29, 1100), row(30, 700), row(27, 100, { source: 'manual' })], item, now)
    expect(result.typical).toBeNull()
    expect(result.days).toBe(2)
    expect(result.lowest).toBe(700)
  })
  it('takes the median of daily minima so repeated refreshes do not bias the usual price', () => {
    const result = priceHistory([row(27, 1500), row(28, 1200), row(28, 1000), row(29, 1100), row(30, 700)], item, now)
    expect(result.typical).toBe(1100)
    expect(result.belowTypical).toBe(400)
    expect(result.isLowest).toBe(true)
  })
  it('separates variants and ignores observations older than 30 days in the typical price', () => {
    const history = [row(27, 1000), row(28, 1200), row(29, 1100), row(26, 100, {variant:'Paperback'}), row(25, 200, {observed_at:'2026-09-01T10:00:00Z'})]
    const result = priceHistory(history, item, now)
    expect(result.typical).toBe(1100)
    expect(result.points).toHaveLength(4)
  })
  it('never compares a manual current price against historical sale prices', () => {
    const result = priceHistory([row(27, 1000), row(28, 1200), row(29, 1100)], { ...item, checked_at: null }, now)
    expect(result.belowTypical).toBeNull()
    expect(result.isLowest).toBe(false)
  })
})
describe('Quick capture links', () => {
  it('accepts shared URLs embedded in text and preserves product variant selectors', () => {
    expect(captureUrl('A nice book https://shop.example.com/item?variant=blue')).toBe('https://shop.example.com/item?variant=blue')
    expect(captureQuery('https://shop.example.com/item')).toContain('SAME variant')
  })
  it('rejects private, credential-bearing, and executable links', () => {
    for (const url of ['http://example.com/item','https://127.0.0.1/x','https://localhost/x','https://u:p@example.com/x','javascript:alert(1)', null]) expect(captureUrl(url)).toBeNull()
  })
})
