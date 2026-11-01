import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { adminDatabase, databaseConfig } from '../../server/utils/database'
import { dbResult } from '../../server/utils/database-core'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('Worker database configuration', () => {
  it('keeps safe HTTP errors compatible with Nitro after removing h3 from worker imports', async () => {
    const app = createApp()
    app.use(defineEventHandler(() => dbResult({ data: null, error: new Error('private database diagnostic') })))
    const response = await toWebHandler(app)(new Request('https://osk.example.com/api/test'))
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).toContain('The change could not be saved')
    expect(body).not.toContain('private database diagnostic')
  })
  it('requires only the project URL and service key for server access, while browser access still needs its public key', () => {
    vi.stubEnv('NUXT_PUBLIC_SUPABASE_URL', 'https://qa.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-only')
    vi.stubEnv('NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
    adminDatabase()
    expect(createClient).toHaveBeenCalledWith('https://qa.supabase.co', 'service-test-only', { auth: { persistSession: false, autoRefreshToken: false } })
    expect(() => databaseConfig()).toThrow('Supabase is not configured')
  })
  it('fails closed when the service key is missing', () => {
    vi.stubEnv('NUXT_PUBLIC_SUPABASE_URL', 'https://qa.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(() => adminDatabase()).toThrow('Server database access is not configured')
    expect(createClient).not.toHaveBeenCalled()
  })
})
