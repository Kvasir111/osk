import {test,expect,type Page} from '@playwright/test'
const owner='10000000-0000-4000-8000-000000000001',list='20000000-0000-4000-8000-000000000001'
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function setup(page:Page) {
 const now=new Date().toISOString(),exp=Math.floor(Date.now()/1000)+3600
 const payload=Buffer.from(JSON.stringify({sub:owner,role:'authenticated',exp})).toString('base64url')
 await page.addInitScript(session=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(session)),{access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:owner,email:'qa@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:now}})
 await page.route('https://qa.supabase.co/**',route=>route.fulfill({status:400,json:{}}))
 await page.route('**/*',async route=>{
  if(route.request().resourceType()!=='document')return route.fallback()
  const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""','supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"')})
 })
 const items=Array.from({length:4},(_,n)=>({id:id(n+1),list_id:list,name:`Tracked wish ${n+1}`,variant:'Blue',category:'Home',notes:'',msrp_cents:null,msrp_source_url:null,status:'active',offers:[{retailer:'Shop',url:`https://shop.example.com/product-${n+1}`,price_cents:4500,seller_type:'retailer',us_shipping:'unknown',availability:'unknown',shipping_note:'Member discount; shipping extra'}],created_at:now,checked_at:new Date(Date.now()-72*3600000).toISOString(),last_attempt_at:new Date(Date.now()-3600000).toISOString(),refresh_status:'failed',price_check_details:{warnings:['This store blocked automated access.'],retailer_checks:[]}}))
 const state={watches:[] as any[],alerts:[] as any[],calls:[] as string[],targetWrites:[] as any[],readWrites:0}
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(path==='/api/profile')return route.fulfill({json:{display_name:'QA',avatar_url:null}})
  if(path==='/api/research-config')return route.fulfill({json:{ai_enabled:false}})
  if(path==='/api/lists')return route.fulfill({json:{lists:[{id:list,owner_id:owner,name:'Tracked wishes',description:'',occasion:'everyday',share_token:null,created_at:now}],memberships:[]}})
  if(path===`/api/lists/${list}/items`)return route.fulfill({json:items})
  if(path==='/api/tracking')return route.fulfill({json:{watches:state.watches,alerts:state.alerts,unread_count:state.alerts.filter(a=>!a.read_at).length}})
  if(path==='/api/price-alerts/read') {state.readWrites++;const input=request.postDataJSON();for(const alert of state.alerts)if(!input.id||input.id===alert.id)alert.read_at=now;return route.fulfill({json:{ok:true}})}
  const target=path.match(/^\/api\/items\/([^/]+)\/target$/)
  if(target){
   if(request.method()==='DELETE'){state.watches=state.watches.filter(w=>w.item_id!==target[1]);return route.fulfill({json:{ok:true}})}
   const input=request.postDataJSON();state.targetWrites.push(input)
   const watch={id:'watch',user_id:owner,item_id:target[1],target_cents:input.target_cents,is_met:false,last_price_cents:null,last_checked_at:null,created_at:now,updated_at:now}
   state.watches=[watch];return route.fulfill({json:watch})
  }
  const refresh=path.match(/^\/api\/items\/([^/]+)\/refresh$/)
  if(refresh){
   state.calls.push(refresh[1]!)
   if(state.calls.length===3)return route.fulfill({status:429,json:{statusMessage:'Daily lookup limit reached (20 checks/lookups). Try again tomorrow.'}})
   const item=items.find(i=>i.id===refresh[1])!
   if(state.calls.length===1){item.refresh_status='ok';item.checked_at=now;item.last_attempt_at=now;item.price_check_details={warnings:[],retailer_checks:[]};return route.fulfill({json:{status:'ok'}})}
   item.last_attempt_at=now;return route.fulfill({json:{status:'failed'}})
  }
  if(path.includes('/history'))return route.fulfill({json:[]})
  return route.fulfill({status:404,json:{}})
 })
 return {state,items,now}
}

test('tracking health explains failures, retries in order, and stops at the existing daily limit',async({page})=>{
 const {state}=await setup(page)
 await page.setViewportSize({width:390,height:844})
 await page.goto('/tracking')
 await expect(page.getByRole('heading',{name:'Tracking & alerts',exact:true})).toBeVisible()
 await expect(page.locator('.tracking-row')).toHaveCount(4)
 await expect(page.locator('.tracking-row').first()).toContainText('This store blocked automated access.')
 await page.getByRole('button',{name:'Select failed checks',exact:true}).click()
 await page.getByRole('button',{name:'Retry selected checks',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('4 / 4 checks finished')
 expect(state.calls).toEqual([id(1),id(2),id(3)])
 await expect(page.locator('.tracking-row').nth(0)).toContainText('Fresh')
 await expect(page.locator('.tracking-row').nth(1)).toContainText('previous prices kept')
 await expect(page.locator('.tracking-row').nth(1)).toContainText('$45')
 await expect(page.locator('.tracking-row').nth(3)).toContainText('Not retried: daily lookup limit reached.')
 for(const colorScheme of ['light','dark'] as const){
  await page.emulateMedia({colorScheme})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`/tmp/osk-tracking-${colorScheme}.png`,fullPage:true,animations:'disabled'})
 }
})

test('private target prices save in cents and alerts show their source, conditions and read state',async({page})=>{
 const {state,items,now}=await setup(page)
 await page.goto('/tracking')
 await page.locator('.tracking-row').first().getByRole('button',{name:'Details & target',exact:true}).click()
 await page.getByLabel('Target price in USD',{exact:true}).fill('39.95')
 await page.getByRole('button',{name:'Set target',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('next successful price check')
 expect(state.targetWrites).toEqual([{target_cents:3995}])
 await page.keyboard.press('Escape')
 const item=items[0]!
 state.alerts.push({id:'alert',watch_id:'watch',user_id:owner,item_id:item.id,name:item.name,variant:item.variant,price_cents:3500,target_cents:3995,offer:item.offers[0],observed_at:now,read_at:null})
 await page.getByRole('button',{name:'Reload dashboard',exact:true}).click()
 await expect(page.getByRole('link',{name:'Open price alerts',exact:true})).toContainText('1 price alert')
 await page.getByRole('button',{name:'Price alerts (1 unread)',exact:true}).click()
 const alerts=page.getByRole('region',{name:'Your price alerts',exact:true})
 await expect(alerts).toContainText('$35')
 await expect(alerts).toContainText('$39.95')
 await expect(alerts).toContainText('Member discount; shipping extra')
 await expect(alerts.getByRole('link',{name:'Open store'})).toHaveAttribute('href',item.offers[0]!.url)
 await alerts.getByRole('button',{name:'Mark as read',exact:true}).click()
 expect(state.readWrites).toBe(1)
 await expect(page.getByRole('link',{name:'Open price alerts',exact:true})).toHaveCount(0)
 await page.reload()
 await page.getByRole('button',{name:'Price alerts',exact:true}).click()
 await expect(page.locator('.price-alert-row')).toContainText('Read')
})

test('demo targets remain local, can be removed, and dashboard filters are keyboard accessible',async({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'Razer DeathAdder V3',exact:true}).click()
 await page.getByLabel('Target price in USD',{exact:true}).fill('40')
 await page.getByRole('button',{name:'Set target',exact:true}).click()
 await page.keyboard.press('Escape')
 await page.getByRole('link',{name:'Tracking & alerts',exact:true}).click()
 await page.getByLabel('Search tracked wishes').fill('Razer')
 await expect(page.locator('.tracking-row')).toHaveCount(1)
 await expect(page.locator('.tracking-row')).toContainText('Your target: $40')
 await page.reload()
 await page.getByLabel('Search tracked wishes').fill('Razer')
 await page.getByRole('button',{name:'Details & target',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(page.getByLabel('Target price in USD',{exact:true})).toHaveValue('40')
 await page.getByRole('button',{name:'Remove target',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('Target removed')
 await page.keyboard.press('Escape')
 await page.getByRole('combobox',{name:'Tracking status',exact:true}).selectOption('paused')
 await expect(page.locator('.tracking-row')).toHaveCount(0)
})


test('background price refresh acknowledges queued work without claiming prices finished',async({page})=>{
 await setup(page)
 await page.route('**/api/items/*/refresh',route=>route.fulfill({status:202,json:{status:'background'}}))
 await page.setViewportSize({width:390,height:844})
 await page.goto('/tracking')
 await page.getByRole('button',{name:'Select failed checks',exact:true}).click()
 await page.getByRole('button',{name:'Retry selected checks',exact:true}).click()
 await expect(page.locator('.tracking-row').first()).toContainText('Home Depot check queued. Reload in a few minutes for the result.')
 await expect(page.locator('.tracking-row').first()).toContainText('$45')
 await expect(page.getByRole('button',{name:'Retry selected checks',exact:true})).toBeEnabled()
})
