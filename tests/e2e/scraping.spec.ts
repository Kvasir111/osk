import { test, expect, type Page } from '@playwright/test'
const owner = '10000000-0000-4000-8000-000000000001'
const listId = '20000000-0000-4000-8000-000000000001'
const url = 'https://shop.example.com/ceramic-mug'
async function setup(page: Page, blocked = false) {
  const now = new Date().toISOString(), exp = Math.floor(Date.now()/1000)+3600
  const payload = Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp })).toString('base64url')
  await page.addInitScript(session => localStorage.setItem('sb-qa-auth-token', JSON.stringify(session)), {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-only', token_type: 'bearer', expires_at: exp, expires_in: 3600,
    user: { id: owner, email: 'qa@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: now },
  })
  await page.route('https://qa.supabase.co/**', route => route.fulfill({ status: 400, json: {} }))
  await page.route('**/*', async route => {
    if(route.request().resourceType()!=='document')return route.fallback()
    const response=await route.fetch()
    return route.fulfill({response,body:(await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""','supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"')})
  })
  const state = { lookups: 0, agents: 0, writes: [] as any[], items: [] as any[] }
  const product = { name: 'Ceramic mug', variant: 'Blue', category: 'Home', notes: `Product link: ${url}`, msrp_cents: null, msrp_source_url: null, image_mode: 'auto', image_url: null, image_source_url: null,
    offers: [{ retailer: 'shop.example.com', url, price_cents: 1999, seller_type: 'retailer', us_shipping: 'unknown', availability: 'in_stock', shipping_note: 'Page metadata; shipping unverified.' }] }
  await page.route('**/api/**', async route => {
    const request=route.request(), path=new URL(request.url()).pathname
    if(path==='/api/research-config')return route.fulfill({json:{ai_enabled:false}})
    if(path==='/api/profile')return route.fulfill({json:{display_name:'QA',avatar_url:null}})
    if(path==='/api/lists')return route.fulfill({json:{lists:[{id:listId,owner_id:owner,name:'My wishes',description:'',occasion:'everyday',share_token:null,created_at:now}],memberships:[],user_id:owner}})
    if(path===`/api/lists/${listId}/items`){
      if(request.method()==='POST'){
        const input=request.postDataJSON();state.writes.push(input)
        const item={...input.product,id:input.client_id||'item',list_id:listId,created_at:now,checked_at:input.checked_at||null,last_attempt_at:input.checked_at||null,refresh_status:input.checked_at?'ok':'never'}
        state.items.push(item);return route.fulfill({json:item})
      }
      return route.fulfill({json:state.items})
    }
    if(path==='/api/capture'){
      state.lookups++;expect(request.postDataJSON()).toEqual({url})
      return route.fulfill({json:{products:blocked?[]:[product],sources:[{title:'Ceramic mug',url}],checked_at:now,summary:blocked?'This store blocked access. Enter the item manually.':'Details read from the product page.',warnings:blocked?['No price verified']:[],retailer_checks:blocked?[{retailer:'Store',url,note:'Blocked'}]:[]}})
    }
    if(path==='/api/searches'){if(request.method()==='POST')state.agents++;return route.fulfill({json:[]})}
    return route.fulfill({status:404,json:{}})
  })
  return state
}
test('shared links are read only after a click and scraped prices require approval without an agent job',async({page})=>{
  const state=await setup(page)
  await page.setViewportSize({width:390,height:844})
  await page.goto(`/capture?url=${encodeURIComponent(url)}`)
  expect(state.lookups).toBe(0)
  await page.getByRole('button',{name:'Preview product & price'}).click()
  await expect(page.getByRole('heading',{name:'Ceramic mug',exact:true})).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('$19.99')
  expect(state.writes).toHaveLength(0)
  await page.getByRole('button',{name:'Approve & add to list',exact:true}).click()
  await expect(page.locator('.capture-page .success-message')).toContainText('Ceramic mug added')
  expect(state.lookups).toBe(1);expect(state.agents).toBe(0)
  expect(state.writes).toHaveLength(1);expect(state.writes[0].search_id).toBeUndefined()
  expect(state.writes[0].product.offers[0].price_cents).toBe(1999)
  await page.emulateMedia({colorScheme:'dark'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('a blocked page keeps its source link for a manual wish without a price',async({page})=>{
  const state=await setup(page,true)
  await page.goto(`/capture?url=${encodeURIComponent(url)}`)
  await page.getByRole('button',{name:'Preview product & price'}).click()
  await expect(page.getByRole('dialog')).toContainText('This store blocked access')
  await page.getByRole('dialog').getByRole('button',{name:'Enter details manually from this link',exact:true}).click()
  await page.getByLabel('Product name',{exact:true}).fill('My mug')
  await page.getByRole('button',{name:'Add to wishlist',exact:true}).click()
  await expect(page.locator('.capture-page .success-message')).toContainText('My mug added')
  await expect.poll(()=>state.writes.length).toBe(1)
  expect(state.writes[0].product.notes).toContain(url)
  expect(state.writes[0].product.offers).toEqual([])
  expect(state.agents).toBe(0)
})
test('grouped products require an explicit option lookup and approval before saving its price',async({page})=>{
  const state=await setup(page)
  const selected=url+'?b=1131004-1139452-3698',lookups:string[]=[]
  await page.route('**/api/capture',async route=>{
    const requested=route.request().postDataJSON().url;lookups.push(requested)
    const exact=requested===selected
    return route.fulfill({json:{summary:'Review the selected configuration.',checked_at:new Date().toISOString(),sources:[],
      products:[{name:'Rogue FM-6 Twin Functional Trainer',variant:exact?'Textured Black':'',category:'Fitness',notes:`Product link: ${requested}`,msrp_cents:null,msrp_source_url:null,
        offers:exact?[{retailer:'Rogue Fitness',url:selected,price_cents:574700,seller_type:'retailer',us_shipping:'unknown',availability:'in_stock',shipping_note:'Checkout conditions unverified.'}]:[]}],
      warnings:exact?[]:['Choose an exact option or save without a price.'],variants:[{label:'Rogue FM-6 Twin Functional Trainer · Textured Black / Stainless Steel · RF0999-90-24-BLACK-TXT-SS',url:selected}]}})
  })
  await page.setViewportSize({width:390,height:844})
  await page.goto(`/capture?url=${encodeURIComponent(url)}`)
  await page.getByRole('button',{name:'Preview product & price'}).click()
  const dialog=page.getByRole('dialog')
  await expect(dialog).toContainText('No price verified')
  await page.getByLabel('Product option').selectOption(selected)
  expect(lookups).toEqual([url]);expect(state.writes).toHaveLength(0)
  for(const colorScheme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
    await dialog.screenshot({path:test.info().outputPath(`grouped-product-${colorScheme}.png`)})
  }
  await page.getByRole('button',{name:'Read selected option',exact:true}).click()
  await expect(dialog).toContainText('$5,747')
  expect(state.writes).toHaveLength(0)
  await page.getByRole('button',{name:'Approve & add to list',exact:true}).click()
  await expect.poll(()=>state.writes.length).toBe(1)
  expect(lookups).toEqual([url,selected])
  expect(state.writes[0].product.offers[0]).toMatchObject({url:selected,price_cents:574700})
})
test('name-only lookup offers manual entry without making a search or scraping request',async({page})=>{
  const state=await setup(page)
  await page.goto('/')
  await page.getByLabel('Find a product for your wishlist').fill('A beautiful mug')
  await page.getByRole('button',{name:'Search for products',exact:true}).click()
  await page.getByRole('button',{name:'Read product page',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Paste a public HTTPS product link')
  await page.getByRole('dialog').getByRole('button',{name:'Enter details manually',exact:true}).click()
  await expect(page.getByLabel('Product name',{exact:true})).toHaveValue('A beautiful mug')
  expect(state.lookups).toBe(0);expect(state.agents).toBe(0)
})
test('additional store URLs can be saved without prices for later scraping',async({page})=>{
  const state=await setup(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Add a wish',exact:true}).click()
  await page.getByLabel('Product name',{exact:true}).fill('Ceramic mug')
  await page.getByRole('button',{name:'Add a store',exact:true}).click()
  await page.getByLabel('Store',{exact:true}).fill('First shop')
  await page.getByLabel('Product URL',{exact:true}).fill(url)
  await page.getByRole('button',{name:'Add a store',exact:true}).click()
  await page.getByLabel('Store',{exact:true}).nth(1).fill('Second shop')
  await page.getByLabel('Product URL',{exact:true}).nth(1).fill('https://second.example.com/mug')
  await page.getByRole('button',{name:'Add to wishlist',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(()=>state.writes.length).toBe(1)
  expect(state.writes[0].product.offers).toEqual([])
  expect(state.writes[0].product.notes).toContain(url)
  expect(state.writes[0].product.notes).toContain('https://second.example.com/mug')
})
