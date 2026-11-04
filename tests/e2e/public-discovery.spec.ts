import {test,expect} from '@playwright/test'

test('public discovery files are real files and missing file routes do not become the app shell',async({request,page})=>{
  const llms=await request.get('/llms.txt')
  expect(llms.status()).toBe(200)
  expect(llms.headers()['content-type']).toMatch(/^text\/plain/)
  const markdown=await llms.text()
  expect(markdown).toMatch(/^# Ósk\n/)
  expect(markdown).toContain('[Sign in](https://osk.ryanrowe.dev/login)')
  expect(markdown).not.toContain('<!DOCTYPE')
  for(const path of ['/.well-known/ard.json','/.well-known/ai-catalog.json','/.well-known/not-advertised','/missing-discovery.txt','/missing-image.png']){
    const response=await request.get(path)
    expect(response.status(),path).toBe(404)
    expect(await response.text(),path).not.toContain('<!DOCTYPE')
    expect((await request.head(path)).status(),path).toBe(404)
  }
  for(const path of ['/robots.txt','/theme-init.js','/favicon.svg','/manifest.webmanifest','/icons/osk-180.png']){
    expect((await request.get(path)).status(),path).toBe(200)
  }
  expect((await request.get('/capture?url=https%3A%2F%2Fshop.example.com%2Fproduct.html')).status()).toBe(200)
  await page.goto('/login')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow')
})
