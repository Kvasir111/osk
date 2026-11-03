import { test, expect, type Page } from '@playwright/test'
const userId = '10000000-0000-4000-8000-000000000001'
const listId = '20000000-0000-4000-8000-000000000001'
const jobId = '30000000-0000-4000-8000-000000000001'
const productUrl = 'https://www.511tactical.com/taconic-weight-vest.html'
async function setup(page: Page, status: 'queued' | 'running' | 'failed', url: string | null = productUrl, pollingFails = false) {
  const now = new Date().toISOString(), exp = Math.floor(Date.now() / 1000) + 3600
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp })).toString('base64url')
  await page.addInitScript(session => localStorage.setItem('sb-qa-auth-token', JSON.stringify(session)), {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-only', token_type: 'bearer', expires_at: exp, expires_in: 3600,
    user: { id: userId, email: 'qa@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: now },
  })
  await page.route('https://qa.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    return route.fulfill({ response, body: (await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""', 'supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"') })
  })
  const list = { id: listId, owner_id: userId, name: 'My wishes', description: '', occasion: 'everyday', created_at: now, share_token: null }
  const job = { id: jobId, user_id: userId, product_url: url, query: url || 'Taconic weight vest', status, stages: [{ id: 'identify', label: 'Product listing', status: status === 'failed' ? 'failed' : 'waiting' }], result: null, error_message: status === 'failed' ? 'This search stopped before finishing.' : null, approved_item_id: null, approved_snapshot: null, created_at: now, updated_at: now, finished_at: status === 'failed' ? now : null }
  const items: any[] = [], writes: any[] = []
  let started = false
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/research-config') return route.fulfill({ json: { ai_enabled: true } })
    if (path === '/api/profile') return route.fulfill({ json: { display_name: 'QA', avatar_url: null } })
    if (path === '/api/lists') return route.fulfill({ json: { lists: [list], memberships: [], user_id: userId } })
    if (path === `/api/lists/${listId}/items`) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push(body)
        items.push({ ...body.product, id: body.client_id || 'item', list_id: listId, created_at: now, checked_at: null, last_attempt_at: null, refresh_status: 'never' })
        return route.fulfill({ json: items[items.length - 1] })
      }
      return route.fulfill({ json: items })
    }
    if (path === '/api/searches') {
      if (request.method() === 'POST') { started = true; return route.fulfill({ json: job }) }
      return route.fulfill({ json: started ? [job] : [] })
    }
    if (path === `/api/searches/${jobId}`) return pollingFails ? route.fulfill({ status: 503, json: { statusMessage: 'Temporarily unavailable' } }) : route.fulfill({ json: job })
    return route.fulfill({ status: 404, json: {} })
  })
  return { writes, items }
}
for (const status of ['queued', 'failed'] as const) {
  test(`a ${status} background search can immediately switch to manual entry and save the link without a price`, async ({ page }) => {
    const state = await setup(page, status)
    await page.goto(`/capture?url=${encodeURIComponent(productUrl)}`)
    await page.getByRole('button', { name: 'Preview product & price' }).click()
    const dialog = page.getByRole('dialog')
    if (status === 'failed') await expect(dialog.getByRole('alert')).toContainText('stopped before finishing')
    await dialog.getByRole('button', { name: 'Enter details manually from this link', exact: true }).click()
    await expect(page.getByLabel('Product URL', { exact: true })).toHaveValue(productUrl)
    await page.getByLabel('Product name', { exact: true }).fill('Taconic weight vest')
    await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click()
    await expect(page.locator('.capture-page .success-message')).toContainText('Taconic weight vest added')
    await expect.poll(() => state.writes.length).toBe(1)
    expect(state.writes[0].search_id).toBeUndefined()
    expect(state.items[0].notes).toContain(productUrl)
    expect(state.items[0].offers).toEqual([])
  })
}
test('a resumed failed name search preserves the name and needs no product URL for manual entry', async ({ page }) => {
  const state = await setup(page, 'failed', null)
  await page.goto(`/capture?search=${jobId}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('stopped before finishing')
  await dialog.getByRole('button', { name: 'Enter details manually', exact: true }).click()
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Taconic weight vest')
  await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click()
  await expect(page.locator('.capture-page .success-message')).toContainText('Taconic weight vest added')
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.writes[0].search_id).toBeUndefined()
})
test('a running search with broken progress polling still allows manual saving', async ({ page }) => {
  const state = await setup(page, 'running', productUrl, true)
  await page.goto(`/capture?url=${encodeURIComponent(productUrl)}`)
  await page.getByRole('button', { name: 'Preview product & price' }).click()
  await expect(page.getByRole('complementary', { name: 'Product research' })).toContainText('Reconnecting', { timeout: 10000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Enter details manually from this link', exact: true }).click()
  await page.getByLabel('Product name', { exact: true }).fill('My vest')
  await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click()
  await expect(page.locator('.capture-page .success-message')).toContainText('My vest added')
  await expect.poll(() => state.writes.length).toBe(1)
})
test('dashboard search dispatch errors still allow a manual wish with the typed name', async ({ page }) => {
  const state = await setup(page, 'failed', null)
  await page.route('**/api/searches', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { statusMessage: 'Background research could not start.' } }) : route.fallback())
  await page.goto('/')
  await page.getByLabel('Find a product for your wishlist').fill('Taconic weight vest')
  await page.getByRole('button', { name: 'Search for products', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('could not start')
  await dialog.getByRole('button', { name: 'Enter details manually', exact: true }).click()
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Taconic weight vest')
  await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.writes[0].search_id).toBeUndefined()
})
