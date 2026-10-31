import { z } from 'zod'

export const santaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  budget_cents: z.number().int().min(1).max(100000000).nullable().default(null),
  exchange_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Choose a valid exchange date.').nullable().default(null),
  exclusions: z.array(z.tuple([z.string().uuid(), z.string().uuid()])).max(200).default([]),
})
export interface SantaEvent {
  id: string
  family_id: string
  name: string
  budget_cents: number | null
  exchange_date: string | null
  exclusions: [string, string][]
  drawn_at: string | null
  created_at: string
}
export interface SantaDetail {
  event: SantaEvent
  participants: string[]
  recipient_id: string | null
}

// Randomized augmenting-path matching finds a complete valid draw, or proves none exists.
export function drawSanta(participants: string[], exclusions: [string, string][], randomIndex: (max: number) => number): { giver_id: string; recipient_id: string }[] | null {
  if (participants.length < 3 || participants.length > 50 || new Set(participants).size !== participants.length) return null
  const shuffle = (values: string[]) => {
    const result = [...values]
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1)
      ;[result[i], result[j]] = [result[j]!, result[i]!]
    }
    return result
  }
  const allowed = new Map(participants.map(giver => [giver, shuffle(participants.filter(recipient =>
    giver !== recipient && !exclusions.some(([a, b]) => (a === giver && b === recipient) || (b === giver && a === recipient))))]))
  const matched = new Map<string, string>()
  function assign(giver: string, seen: Set<string>): boolean {
    for (const recipient of allowed.get(giver) || []) {
      if (seen.has(recipient)) continue
      seen.add(recipient)
      const previous = matched.get(recipient)
      if (!previous || assign(previous, seen)) { matched.set(recipient, giver); return true }
    }
    return false
  }
  for (const giver of shuffle(participants)) if (!assign(giver, new Set())) return null
  return [...matched].map(([recipient_id, giver_id]) => ({ giver_id, recipient_id }))
}
