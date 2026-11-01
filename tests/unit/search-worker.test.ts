import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../netlify/functions/product-search-background'
import { adminDatabase } from '../../server/utils/database-core'
import { runSearchJob } from '../../server/utils/search-jobs'
vi.mock('../../server/utils/database-core', () => ({ adminDatabase: vi.fn() }))
vi.mock('../../server/utils/search-jobs', () => ({ runSearchJob: vi.fn() }))
const id = '10000000-0000-4000-8000-000000000001'
function request(token = 'worker-test-only') {
  return new Request('https://osk.example.com/.netlify/functions/product-search-background', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PRICE_REFRESH_SECRET', 'worker-test-only')
  vi.stubEnv('NUXT_PUBLIC_SUPABASE_URL', 'https://qa.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-only')
  vi.stubEnv('OPENAI_API_KEY', 'provider-test-only')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('Netlify research worker diagnostics', () => {
  it('rejects unauthorized calls without opening the database or researching', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await worker(request('incorrect'))).status).toBe(401)
    expect(adminDatabase).not.toHaveBeenCalled()
    expect(runSearchJob).not.toHaveBeenCalled()
  })
  it('reports missing runtime variable names without logging their values', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('OPENAI_API_KEY', '')
    await expect(worker(request())).rejects.toThrow('configuration missing')
    expect(log).toHaveBeenCalledWith('Product research worker configuration missing', { id, variables: ['OPENAI_API_KEY'] })
    expect(runSearchJob).not.toHaveBeenCalled()
  })
  it('runs the authenticated job and records its receipt without including the query or keys', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.mocked(runSearchJob).mockResolvedValue(undefined)
    expect((await worker(request())).status).toBe(204)
    expect(runSearchJob).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('Product research worker received job', { id })
  })
})
