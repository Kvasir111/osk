import { describe, expect, it } from 'vitest'
import { stalledSearch } from '../../shared/search-progress'

const now = Date.parse('2026-11-01T12:00:00Z')
const stages = [{ id: 'identify', label: 'Product listing', status: 'waiting' as const }]
describe('Research startup and heartbeat expiry', () => {
  it('reports a worker that never starts after 30 seconds rather than waiting three minutes', () => {
    const job = { status: 'queued' as const, updated_at: new Date(now - 31000).toISOString(), stages }
    const result = stalledSearch(job, now)!
    expect(result.error_message).toContain('worker did not start')
    expect(result.status).toBe('failed')
    expect(result.stages[0]?.status).toBe('failed')
    expect(stalledSearch({ ...job, updated_at: new Date(now - 29000).toISOString() }, now)).toBeNull()
  })
  it('allows running work to finish and preserves completed stages when a heartbeat expires', () => {
    const job = { status: 'running' as const, updated_at: new Date(now - 170000).toISOString(), stages: [{ ...stages[0]!, status: 'completed' as const }, { id: 'retailers', label: 'Stores', status: 'running' as const }] }
    expect(stalledSearch(job, now)).toBeNull()
    const expired = stalledSearch({ ...job, updated_at: new Date(now - 181000).toISOString() }, now)!
    expect(expired.stages.map(s => s.status)).toEqual(['completed', 'failed'])
    expect(expired.error_message).toContain('Available findings are kept')
  })
  it('never expires completed or failed work', () => {
    for (const status of ['completed', 'failed'] as const) expect(stalledSearch({ status, updated_at: new Date(0).toISOString(), stages }, now)).toBeNull()
  })
})
