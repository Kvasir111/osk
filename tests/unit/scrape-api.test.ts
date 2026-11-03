import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import handler from '../../server/api/[...path]'
import { requireUser, adminDatabase } from '../../server/utils/database'
import { scrapeProducts } from '../../server/utils/product-scraper'
vi.mock('../../server/utils/database', async original => ({ ...await original<typeof import('../../server/utils/database')>(), requireUser: vi.fn(), adminDatabase: vi.fn() }))
vi.mock('../../server/utils/product-scraper', async original => ({ ...await original<typeof import('../../server/utils/product-scraper')>(), scrapeProducts: vi.fn() }))
const rpc = vi.fn()
function call(path: string, method = 'GET', body?: unknown) {
  const app = createApp()
  app.use(defineEventHandler(event => { event.context.params = { path }; return handler(event) }))
  return toWebHandler(app)(new Request(`https://osk.example.com/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }))
}
beforeEach(() => {
  vi.clearAllMocks();vi.stubEnv('PRODUCT_RESEARCH_MODE','scrape');vi.stubEnv('OPENAI_API_KEY','test-only-existing-key')
  vi.mocked(requireUser).mockResolvedValue({ db: {} as any, user: { id: 'owner' } as any })
  vi.mocked(adminDatabase).mockReturnValue({ rpc } as any)
  rpc.mockResolvedValue({ data: true, error: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('Scraping API is the default', () => {
  it('exposes disabled AI and rejects agent creation without spending a lookup slot', async () => {
    expect(await (await call('research-config')).json()).toEqual({ ai_enabled: false })
    const response = await call('searches','POST',{ query: 'A book' })
    expect(response.status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
    expect(scrapeProducts).not.toHaveBeenCalled()
  })
  it('scrapes an authenticated product URL without an OpenAI key', async () => {
    vi.stubEnv('OPENAI_API_KEY','')
    vi.mocked(scrapeProducts).mockResolvedValue({ products: [], sources: [], checked_at: 'now', summary: 'Blocked; enter manually.' })
    expect((await call('capture','POST',{ url: 'https://shop.example.com/book' })).status).toBe(200)
    expect(scrapeProducts).toHaveBeenCalledWith(['https://shop.example.com/book'])
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects unsafe URLs and name-only lookup before fetching', async () => {
    expect((await call('capture','POST',{ url: 'https://127.0.0.1/private' })).status).toBe(400)
    expect((await call('search','POST',{ query: 'A book' })).status).toBe(400)
    expect(scrapeProducts).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
