import { test, expect, type Page } from '@playwright/test'
const owner = '10000000-0000-4000-8000-000000000001'
const second = '10000000-0000-4000-8000-000000000002'
const third = '10000000-0000-4000-8000-000000000003'
const fourth = '10000000-0000-4000-8000-000000000004'
const familyId = '20000000-0000-4000-8000-000000000001'
const eventId = '30000000-0000-4000-8000-000000000001'
async function connected(page: Page, signedIn = true) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const payload = Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp })).toString('base64url')
  if (signedIn) await page.addInitScript(session => localStorage.setItem('sb-qa-auth-token', JSON.stringify(session)), {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: owner, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  })
  await page.route('https://qa.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    const body = (await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""', 'supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"')
    return route.fulfill({ response, body })
  })
}
test('organizer creates an event, opts in, saves exclusions, and sees only their recipient after drawing', async ({ page }) => {
  await connected(page)
  const family = { id: familyId, owner_id: owner, name: 'Our family', created_at: new Date().toISOString() }
  let event: any = null
  let participants = [second, third, fourth]
  let recipient: string | null = null
  const members = [{ user_id: owner, display_name: 'Alex', avatar_url: null }, { user_id: second, display_name: 'Sam', avatar_url: null }, { user_id: third, display_name: 'Robin', avatar_url: null }, { user_id: fourth, display_name: 'Casey', avatar_url: null }]
  const calls: string[] = []
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    if (path === '/api/profile') return route.fulfill({ json: { display_name: 'Alex', avatar_url: null } })
    if (path === '/api/lists') return route.fulfill({ json: { lists: [], memberships: [], user_id: owner } })
    if (path === '/api/searches') return route.fulfill({ json: [] })
    if (path === '/api/families') return route.fulfill({ json: [family] })
    if (path === `/api/families/${familyId}`) return route.fulfill({ json: { family, members, links: [] } })
    if (path === `/api/santa/${familyId}/events`) {
      if (method === 'GET') return route.fulfill({ json: event ? [event] : [] })
      event = { ...request.postDataJSON(), id: eventId, family_id: familyId, drawn_at: null, created_at: new Date().toISOString() }
      return route.fulfill({ json: { id: eventId } })
    }
    if (path === `/api/santa/${eventId}`) {
      if (method === 'GET') return route.fulfill({ json: { event, participants, recipient_id: recipient } })
      if (method === 'PATCH') event = { ...event, ...request.postDataJSON() }
      if (method === 'DELETE') event = null
      return route.fulfill({ json: { ok: true } })
    }
    calls.push(path)
    if (path.endsWith('/join')) participants.push(owner)
    if (path.endsWith('/draw')) { event.drawn_at = new Date().toISOString(); recipient = second }
    return route.fulfill({ json: { ok: true } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/family')
  const section = page.getByRole('region', { name: 'Secret Santa', exact: true })
  await section.getByLabel('Event name', { exact: true }).fill('Christmas 2026')
  await section.getByLabel('Gift budget in USD').fill('50')
  await section.getByLabel('Exchange date').fill('2026-12-25')
  await section.getByRole('button', { name: 'Create Secret Santa event', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Join this event', exact: true })).toBeVisible()
  await section.getByRole('button', { name: 'Join this event', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Draw names', exact: true })).toBeEnabled()
  await section.getByLabel('First person').selectOption(owner)
  await section.getByLabel('Second person').selectOption(third)
  await section.getByRole('button', { name: 'Add excluded pair', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Draw names', exact: true })).toBeDisabled()
  await section.getByRole('button', { name: 'Save event settings', exact: true }).click()
  expect(event.exclusions).toEqual([[owner, third]])
  page.on('dialog', dialog => dialog.accept())
  await section.getByRole('button', { name: 'Draw names', exact: true }).click()
  await expect(section.getByRole('heading', { name: 'Your recipient: Sam', exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: 'Draw names', exact: true })).toHaveCount(0)
  await expect(section.getByLabel('Event name', { exact: true })).toHaveCount(0)
  await expect(section).toContainText('This draw is locked')
  expect(calls.filter(path => path.endsWith('/draw'))).toHaveLength(1)
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('shared title and text can be reviewed and saved without a known price or automatic research', async ({ page }) => {
  let searches = 0
  await page.route('**/api/searches', route => { searches++; return route.fulfill({ json: {} }) })
  await page.goto('/capture?title=A%20nice%20book&text=Look%20at%20https%3A%2F%2Fshop.example.com%2Fbook%3Fedition%3Dblue')
  await expect(page.getByLabel('Product link', { exact: true })).toHaveValue('https://shop.example.com/book?edition=blue')
  await expect(page.getByRole('status')).toContainText('Shared link received')
  await page.getByRole('button', { name: 'Enter details manually from this link', exact: true }).click()
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('A nice book')
  await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('A nice book added')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('osk-demo-v1')!))
  const item = stored.items.find((item: any) => item.name === 'A nice book')
  expect(item.offers).toEqual([])
  expect(item.notes).toContain('https://shop.example.com/book?edition=blue')
  expect(searches).toBe(0)
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.share_target).toEqual({ action: '/capture', method: 'GET', enctype: 'application/x-www-form-urlencoded', params: { title: 'title', text: 'text', url: 'url' } })
})
test('unsupported shared content gives a paste fallback without opening research', async ({ page }) => {
  await page.goto('/capture?text=just%20a%20description&url=http%3A%2F%2Flocalhost%2Fprivate')
  await expect(page.getByRole('status')).toContainText('did not include a public HTTPS product link')
  await expect(page.getByLabel('Product link', { exact: true })).toHaveValue('')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('signing in preserves the shared link and title in the capture return path', async ({ page }) => {
  await connected(page, false)
  const target = '/capture?title=Gift%20idea&url=https%3A%2F%2Fshop.example.com%2Fitem'
  await page.goto(target)
  await expect(page.getByLabel('Your email', { exact: true })).toBeVisible()
  const next = new URL(new URL(page.url()).searchParams.get('next')!, 'https://osk.example.com')
  expect(next.pathname).toBe('/capture')
  expect(next.searchParams.get('title')).toBe('Gift idea')
  expect(next.searchParams.get('url')).toBe('https://shop.example.com/item')
})
