import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiResearchEnabled } from '../../server/utils/research-mode'
import { researchStage } from '../../server/utils/progressive-search'
import { searchProducts } from '../../server/utils/product-search'
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('No paid calls by default', () => {
  it('requires an exact explicit opt-in; an existing provider key does not enable AI', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.stubEnv('OPENAI_API_KEY', 'test-only-existing-key')
    for (const mode of ['', 'scrape', 'true', 'AI']) {
      vi.stubEnv('PRODUCT_RESEARCH_MODE', mode)
      expect(aiResearchEnabled()).toBe(false)
      await expect(searchProducts('A book')).rejects.toThrow('AI research is disabled')
      await expect(researchStage('A book', { id: 'identify', label: 'Product', focus: 'Identify' })).rejects.toThrow('AI research is disabled')
    }
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubEnv('PRODUCT_RESEARCH_MODE', 'ai')
    expect(aiResearchEnabled()).toBe(true)
  })
})
