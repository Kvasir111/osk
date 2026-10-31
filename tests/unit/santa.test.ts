import { describe, expect, it } from 'vitest'
import { drawSanta, santaSchema } from '../../shared/santa'
import { sharedCapture } from '../../shared/capture'
import { randomInt } from 'node:crypto'

describe('Secret Santa matching', () => {
  it('draws one recipient each, without self matches or exclusions', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f']
    for (let n = 0; n < 100; n++) {
      const result = drawSanta(people, [['a', 'b'], ['c', 'd']], randomInt)!
      expect(result).toHaveLength(people.length)
      expect(new Set(result.map(row => row.giver_id)).size).toBe(people.length)
      expect(new Set(result.map(row => row.recipient_id)).size).toBe(people.length)
      for (const row of result) {
        expect(row.giver_id).not.toBe(row.recipient_id)
        expect([['a', 'b'], ['b', 'a'], ['c', 'd'], ['d', 'c']]).not.toContainEqual([row.giver_id, row.recipient_id])
      }
    }
  })
  it('detects impossible groups, invalid rosters, and handles the maximum roster', () => {
    expect(drawSanta(['a', 'b', 'c'], [['a', 'b']], randomInt)).toBeNull()
    expect(drawSanta(['a', 'b'], [], randomInt)).toBeNull()
    expect(drawSanta(['a', 'a', 'b'], [], randomInt)).toBeNull()
    expect(drawSanta(Array.from({ length: 50 }, (_, n) => String(n)), [], randomInt)).toHaveLength(50)
  })
  it('validates real calendar dates and integer-cent budgets', () => {
    expect(santaSchema.safeParse({ name: 'Christmas', exchange_date: '2026-02-30' }).success).toBe(false)
    expect(santaSchema.safeParse({ name: 'Christmas', budget_cents: 12.5 }).success).toBe(false)
    expect(santaSchema.parse({ name: 'Christmas', budget_cents: 5000, exchange_date: '2026-12-25' }).budget_cents).toBe(5000)
  })
})
describe('Share-sheet payloads', () => {
  it('handles separate URLs, URLs embedded in text, and title-only URL shares', () => {
    expect(sharedCapture({ title: 'A book', text: 'Read this https://shop.example.com/book?format=hardcover' })).toEqual({ received: true, title: 'A book', url: 'https://shop.example.com/book?format=hardcover' })
    expect(sharedCapture({ url: 'https://shop.example.com/exact', text: 'https://other.example.com/item' }).url).toBe('https://shop.example.com/exact')
    expect(sharedCapture({ title: 'https://shop.example.com/item' }).title).toBe('')
    expect(sharedCapture({ title: 'https://shop.example.com/item' }).url).toBe('https://shop.example.com/item')
  })
  it('rejects unsafe links and bounds titles without trusting shared text', () => {
    expect(sharedCapture({ url: 'javascript:alert(1)', text: 'https://localhost/private' }).url).toBe('')
    expect(sharedCapture({ url: ['https://shop.example.com/item'], title: 'x'.repeat(500) }).title).toHaveLength(200)
    expect(sharedCapture({}).received).toBe(false)
  })
})
