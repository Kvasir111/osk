import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const owner='10000000-0000-4000-8000-000000000001'
const other='10000000-0000-4000-8000-000000000002'
const listId='20000000-0000-4000-8000-000000000001'
function session(id=owner,expired=false){
 const now=new Date().toISOString(),exp=Math.floor(Date.now()/1000)+(expired?-120:3600)
 const payload=Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp})).toString('base64url')
 return {access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:exp,user:{id,email:id===owner?'owner@example.com':'other@example.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{display_name:'QA'},created_at:now}}
}
async function setup(page:Page){
 const lists:any[]=[{id:listId,owner_id:owner,name:'Saved wishes',description:'',occasion:'everyday',share_token:null,created_at:new Date().toISOString()}]
 const items:any[]=[]
 const posts:{account:string;id:string}[]=[]
 const transfers:any[]=[]
 const tracking={watches:[] as any[],alerts:[] as any[],writes:[] as string[]}
 const state={dropTransferResponse:false,dropResponse:false,reject:false,unauthorized:false,delayReads:false,releaseReads:[] as Array<() => void>}
 await page.addInitScript(value=>{
  if(!sessionStorage.getItem('qa-seeded')){localStorage.setItem('sb-qa-auth-token',JSON.stringify(value));sessionStorage.setItem('qa-seeded','1')}
 },session())
 await page.route('https://qa.supabase.co/**',route=>route.fulfill({status:400,json:{code:'refresh_token_not_found',message:'Test auth only'}}))
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  const bearer=request.headers()['authorization']?.split('.')[1]
  const account=bearer?JSON.parse(Buffer.from(bearer,'base64url').toString()).sub:null
  if(path==='/api/tracking')return route.fulfill({json:{watches:tracking.watches.filter(w=>w.user_id===account),alerts:tracking.alerts.filter(a=>a.user_id===account),unread_count:tracking.alerts.filter(a=>a.user_id===account&&!a.read_at).length}})
  if(path==='/api/price-alerts/read'){
   tracking.writes.push(account);const input=request.postDataJSON()
   for(const alert of tracking.alerts)if(alert.user_id===account&&(!input.id||input.id===alert.id))alert.read_at=new Date().toISOString()
   return route.fulfill({json:{ok:true}})
  }
  if(path==='/api/profile')return route.fulfill({json:{display_name:'QA',avatar_url:null,email:'owner@example.com'}})
  if(path==='/api/searches')return route.fulfill({json:[]})
  if(path==='/api/lists'&&request.method()==='GET')return route.fulfill({json:{lists:lists.filter(l=>l.owner_id===account),memberships:[],user_id:account}})
  if(path==='/api/lists'&&request.method()==='POST'){
   const input=request.postDataJSON();let list=lists.find(l=>l.id===input.client_id)
   if(!list){list={...input,id:input.client_id,owner_id:account,share_token:null,created_at:new Date().toISOString()};lists.push(list)}
   return route.fulfill({json:list})
  }
  if(path==='/api/items/transfer'&&request.method()==='POST'){
   const input=request.postDataJSON();transfers.push(input)
   const result=input.items.map((entry:any)=>{
    let existing=items.find(i=>i.id===entry.copy_id)
    if(!existing){existing={...items.find(i=>i.id===entry.id),id:entry.copy_id,list_id:input.target,status:'active',checked_at:null,last_attempt_at:null,refresh_status:'never'};items.push(existing)}
    return existing
   })
   if(state.dropTransferResponse){state.dropTransferResponse=false;return route.abort('failed')}
   return route.fulfill({json:result})
  }
  const match=path.match(/^\/api\/lists\/([^/]+)\/items$/)
  if(match&&request.method()==='GET'){
   const json=JSON.parse(JSON.stringify(items.filter(i=>i.list_id===match[1])))
   if(state.delayReads)await new Promise<void>(resolve=>state.releaseReads.push(resolve))
   return route.fulfill({json})
  }
  if(match&&request.method()==='POST'){
   const input=request.postDataJSON();posts.push({account,id:input.client_id})
   if(state.unauthorized)return route.fulfill({status:401,json:{statusMessage:'Sign in again'}})
   if(state.reject)return route.fulfill({status:403,json:{statusMessage:'Access changed'}})
   let item=items.find(i=>i.id===input.client_id)
   if(!item){item={...input.product,id:input.client_id,list_id:match[1],created_at:new Date().toISOString(),checked_at:null,last_attempt_at:null,refresh_status:'never'};items.push(item)}
   if(state.dropResponse){state.dropResponse=false;return route.abort('failed')}
   return route.fulfill({json:item})
  }
  return route.fulfill({status:404,json:{statusMessage:'Test route unavailable'}})
 })
 await page.goto('/')
 await expect(page.getByRole('heading',{name:/^Saved wishes/})).toBeVisible()
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller)
 await page.waitForFunction(()=>new Promise(resolve=>{
  const r=indexedDB.open('osk-offline-v1',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('snapshots').objectStore('snapshots').get('10000000-0000-4000-8000-000000000001');q.onsuccess=()=>{resolve(!!q.result);db.close()}}
 }))
 return {lists,items,posts,transfers,state,tracking}
}
async function addWish(page:Page,name:string){
 await page.getByRole('button',{name:'Add a wish',exact:true}).click()
 await page.getByLabel('Product name',{exact:true}).fill(name)
 await page.getByRole('button',{name:'Add to wishlist',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function outbox(page:Page){
 return page.evaluate(()=>new Promise<any[]>(resolve=>{
  const r=indexedDB.open('osk-offline-v1',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('outbox').objectStore('outbox').getAll();q.onsuccess=()=>{resolve(q.result);db.close()}}
 }))
}
async function stageUpdate(page:Page) {
 const path='.output/public/sw.js',original=await readFile(path,'utf8')
 const updated=original.replace(/(const CACHE = "osk-shell-[^"]+)"/,`$1-test-${crypto.randomUUID()}"`)
 await writeFile(path,updated)
 try {
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration!.update()})
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting)
 } catch(error) { await writeFile(path,original);throw error }
 return ()=>writeFile(path,original)
}

test('app updates wait for approval, keep an open draft, and preserve queued additions after reload',async({page,context})=>{
 const data=await setup(page)
 await expect(page.getByRole('complementary',{name:'App update',exact:true})).toHaveCount(0)
 data.state.reject=true
 await addWish(page,'Queued across an app update')
 const before=await outbox(page)
 expect(before).toHaveLength(1)
 await page.getByRole('button',{name:'Add a wish',exact:true}).click()
 await page.getByLabel('Product name',{exact:true}).fill('Unfinished form stays open')
 const restore=await stageUpdate(page)
 try {
  await expect(page.getByRole('complementary',{name:'App update',exact:true})).toContainText('update is available')
  await expect(page.getByLabel('Product name',{exact:true})).toHaveValue('Unfinished form stays open')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Later',exact:true}).click()
  await expect(page.getByRole('button',{name:'Update & reload',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'App update available',exact:true}).click()
  // Reloading the old shell must not delete a newer worker’s fully downloaded cache.
  await page.reload()
  await expect(page.getByRole('button',{name:'Update & reload',exact:true})).toBeVisible()
  expect(await page.evaluate(async()=>(await caches.keys()).some(key=>key.includes('-test-')))).toBe(true)
  await context.setOffline(true)
  const update=page.getByRole('button',{name:'Update & reload',exact:true})
  await update.focus()
  await Promise.all([page.waitForEvent('load'),update.press('Enter')])
  await expect(page.getByRole('heading',{name:/^Saved wishes/})).toBeVisible()
  expect((await outbox(page)).map(op=>op.id)).toEqual(before.map(op=>op.id))
  await expect(page.getByRole('button',{name:'Update & reload',exact:true})).toHaveCount(0)
 } finally { await restore() }
})

test('updating one tab leaves another tab’s form and old static assets usable',async({page,context})=>{
 await setup(page)
 const other=await context.newPage()
 await setup(other)
 await other.getByRole('button',{name:'Add a wish',exact:true}).click()
 await other.getByLabel('Product name',{exact:true}).fill('A draft in the other tab')
 await page.evaluate(async()=>{
  const key=(await caches.keys()).find(key=>key.startsWith('osk-shell-'))!
  await (await caches.open(key)).put('/_nuxt/previous-build-only.js',new Response('previous public chunk',{headers:{'Content-Type':'text/javascript'}}))
 })
 const restore=await stageUpdate(page)
 try {
  await expect(page.getByRole('button',{name:'Update & reload',exact:true})).toBeVisible()
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Update & reload',exact:true}).click()])
  await expect(other.getByLabel('Product name',{exact:true})).toHaveValue('A draft in the other tab')
  expect(await other.evaluate(async()=>(await fetch('/_nuxt/previous-build-only.js')).text())).toBe('previous public chunk')
  expect(await other.evaluate(async()=>(await fetch('/_nuxt/previous-build-only.js',{headers:{Authorization:'Bearer test-only'}})).status)).toBe(404)
  await expect(other.getByRole('complementary',{name:'App update',exact:true})).toContainText('update is available')
  await other.keyboard.press('Escape')
  await other.setViewportSize({width:390,height:844})
  for(const colorScheme of ['light','dark'] as const){
   await other.emulateMedia({colorScheme})
   expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
   await other.getByRole('complementary',{name:'App update',exact:true}).screenshot({path:test.info().outputPath(`app-update-${colorScheme}.png`),animations:'disabled'})
  }
 } finally { await other.close();await restore() }
})

test('production PWA reloads offline, queues a new list and wish, then syncs once and refreshes',async({page,context})=>{
 const data=await setup(page)
 const manifest=await (await page.request.get('/manifest.webmanifest')).json()
 expect(manifest.display).toBe('standalone');expect(manifest.icons).toHaveLength(3)
 await context.setOffline(true)
 await page.reload()
 await expect(page.getByRole('heading',{name:/^Saved wishes/})).toBeVisible()
 await page.getByRole('button',{name:'Make a new list',exact:true}).click()
 await page.getByLabel('List name').fill('Offline birthday')
 await page.getByRole('button',{name:'Create my list',exact:true}).click()
 await addWish(page,'Offline ceramic mug')
 await expect(page.getByRole('complementary',{name:'Offline and sync status'})).toContainText('2 waiting to sync')
 expect(await outbox(page)).toHaveLength(2)
 await page.reload()
 await page.getByRole('button',{name:/Offline birthday/}).click()
 await expect(page.getByRole('button',{name:'Offline ceramic mug',exact:true})).toBeVisible()
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await expect(page.locator('.sidebar')).toHaveCSS('transform','matrix(1, 0, 0, 1, -254, 0)')
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:'/tmp/osk-pwa-offline-mobile.png',fullPage:true})
 await page.setViewportSize({width:1280,height:720})
 await context.setOffline(false)
 await expect.poll(async()=> (await outbox(page)).length).toBe(0)
 expect(data.lists.filter(l=>l.name==='Offline birthday')).toHaveLength(1)
 expect(data.items.filter(i=>i.name==='Offline ceramic mug')).toHaveLength(1)
 await page.reload()
 await page.getByRole('button',{name:/Offline birthday/}).click()
 await expect(page.getByRole('button',{name:'Offline ceramic mug',exact:true})).toBeVisible()
 const keys=await page.evaluate(async()=>{const result:string[]=[];for(const name of await caches.keys())for(const req of await (await caches.open(name)).keys())result.push(req.url);return result})
 expect(keys.some(url=>url.includes('/api/')||url.includes('supabase.co')||url.includes('access_token'))).toBe(false)
})
test('a lost server response retries the same item id without duplicate additions',async({page,context})=>{
 const data=await setup(page)
 await context.setOffline(true);await addWish(page,'One offline book')
 data.state.dropResponse=true
 await context.setOffline(false)
 await expect.poll(()=>data.items.length).toBe(1)
 await expect(page.getByRole('complementary',{name:'Offline and sync status'})).toContainText('Sync paused')
 await page.getByRole('button',{name:'Retry sync',exact:true}).click()
 await expect.poll(async()=> (await outbox(page)).length).toBe(0)
 expect(data.items).toHaveLength(1)
 expect(new Set(data.posts.map(p=>p.id)).size).toBe(1)
})
test('permission failures retain offline additions and let the user remove the local copy',async({page,context})=>{
 const data=await setup(page)
 await context.setOffline(true);await addWish(page,'Keep this draft')
 data.state.reject=true;await context.setOffline(false)
 await expect(page.getByRole('complementary',{name:'Offline and sync status'})).toContainText('need attention')
 expect(await outbox(page)).toHaveLength(1)
 await page.getByText('Review unsynced additions',{exact:true}).click()
 await expect(page.getByRole('complementary',{name:'Offline and sync status'})).toContainText('permission')
 page.once('dialog',dialog=>dialog.accept())
 await page.getByRole('button',{name:'Remove local addition Keep this draft',exact:true}).click()
 await expect.poll(async()=> (await outbox(page)).length).toBe(0)
 expect(data.items).toHaveLength(0)
})
test('an expired session still opens saved lists offline',async({page,context})=>{
 await setup(page)
 await page.evaluate(value=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(value)),session(owner,true))
 await context.setOffline(true);await page.reload()
 await expect(page.getByRole('heading',{name:/^Saved wishes/})).toBeVisible()
 await addWish(page,'Save despite expired session')
 expect(await outbox(page)).toHaveLength(1)
})
test('a different account never receives or syncs the first account’s offline additions',async({page,context})=>{
 const data=await setup(page)
 await context.setOffline(true);await addWish(page,'Only for the first account')
 data.lists.push({id:'other-list',owner_id:other,name:'Other account wishes',description:'',occasion:'everyday',created_at:new Date().toISOString(),share_token:null})
 await page.evaluate(value=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(value)),session(other))
 await context.setOffline(false);await page.reload()
 await expect(page.getByRole('heading',{name:/^Other account wishes/})).toBeVisible()
 await expect(page.getByText('Only for the first account',{exact:true})).toHaveCount(0)
 expect(data.posts.some(post=>post.account===other)).toBe(false)
})

test('reconnecting refreshes cached prices from the server',async({page,context})=>{
 const data=await setup(page)
 const offer={retailer:'Bookshop',url:'https://shop.example.com/book',price_cents:1000,seller_type:'retailer',us_shipping:'unknown',availability:'unknown',shipping_note:''}
 data.items.push({id:'remote-item',list_id:listId,name:'A tracked offline book',variant:'',category:'Books',notes:'',msrp_cents:null,msrp_source_url:null,offers:[offer],created_at:new Date().toISOString(),checked_at:null,last_attempt_at:null,refresh_status:'never'})
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 const card=page.locator('.product-card').filter({has:page.getByRole('button',{name:'A tracked offline book',exact:true})})
 await expect(card.locator('.price-row')).toContainText('$10')
 await context.setOffline(true)
 data.items[0].offers=[{...offer,price_cents:700}]
 await page.reload()
 await expect(card.locator('.price-row')).toContainText('$10')
 await context.setOffline(false)
 await expect(card.locator('.price-row')).toContainText('$7')
})
test('explicit sign-out warns about unsynced additions and clears this account’s local data',async({page,context})=>{
 await setup(page)
 await context.setOffline(true);await addWish(page,'Local only before logout')
 const cancel=page.waitForEvent('dialog')
 await page.getByRole('button',{name:'Sign out',exact:true}).click()
 await (await cancel).dismiss()
 expect(await outbox(page)).toHaveLength(1)
 const accept=page.waitForEvent('dialog')
 await page.getByRole('button',{name:'Sign out',exact:true}).click()
 await (await accept).accept()
 await expect(page).toHaveURL(/\/login$/)
 expect(await outbox(page)).toHaveLength(0)
 const snapshots=await page.evaluate(()=>new Promise<any[]>(resolve=>{
  const r=indexedDB.open('osk-offline-v1',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>{resolve(q.result);db.close()}}
 }))
 expect(snapshots).toHaveLength(0)
 await page.reload()
 await expect(page.getByLabel('Your email',{exact:true})).toBeVisible()
})

test('a stale refresh cannot overwrite a wish saved while the refresh was in flight',async({page})=>{
 const data=await setup(page)
 data.state.delayReads=true
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect.poll(()=>data.state.releaseReads.length).toBeGreaterThan(0)
 await addWish(page,'Keep the newest wish')
 expect(data.items).toHaveLength(1)
 const finished=page.waitForResponse(response=>response.url().includes(`/api/lists/${listId}/items`)&&response.request().method()==='GET')
 data.state.delayReads=false
 for(const release of data.state.releaseReads)release()
 await finished
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await expect(page.getByRole('button',{name:'Keep the newest wish',exact:true})).toBeVisible()
})

test('sign-in recovery preserves the outbox and syncs after the same account signs back in',async({page,context})=>{
 const data=await setup(page)
 await context.setOffline(true);await addWish(page,'Keep through reauthentication')
 data.state.unauthorized=true
 await context.setOffline(false)
 await expect(page.getByRole('button',{name:'Sign in again →',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Sign in again →',exact:true}).click()
 await expect(page).toHaveURL(/\/login$/)
 expect(await outbox(page)).toHaveLength(1)
 data.state.unauthorized=false
 await page.evaluate(value=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(value)),session())
 await page.goto('/')
 await expect.poll(async()=> (await outbox(page)).length).toBe(0)
 expect(data.items.filter(item=>item.name==='Keep through reauthentication')).toHaveLength(1)
})

test('an offline share opens capture, keeps its link and title, and syncs one manual wish after reconnect', async ({ page, context }) => {
  const data = await setup(page)
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.share_target.action).toBe('/capture')
  expect(manifest.share_target.method).toBe('GET')
  await context.setOffline(true)
  await page.goto('/capture?title=Shared%20ceramic%20mug&text=Found%20this%20https%3A%2F%2Fshop.example.com%2Fmug%3Fcolor%3Dblue')
  await expect(page.getByLabel('Product link', { exact: true })).toHaveValue('https://shop.example.com/mug?color=blue')
  await page.getByRole('button', { name: 'Enter details manually from this link', exact: true }).click()
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Shared ceramic mug')
  await page.getByRole('button', { name: 'Add to wishlist', exact: true }).click()
  await expect(page.locator('.success-message')).toContainText('Shared ceramic mug added')
  expect(await outbox(page)).toHaveLength(1)
  await context.setOffline(false)
  await expect.poll(async () => (await outbox(page)).length).toBe(0)
  expect(data.items.filter(item => item.name === 'Shared ceramic mug')).toHaveLength(1)
  const item = data.items.find(item => item.name === 'Shared ceramic mug')
  expect(item.offers).toEqual([])
  expect(item.notes).toContain('https://shop.example.com/mug?color=blue')
  expect(data.posts).toHaveLength(1)
})

test('offline additions retain gift preferences and priority through reload and sync',async({page,context})=>{
 const data=await setup(page)
 await page.setViewportSize({width:390,height:844})
 await context.setOffline(true)
 await page.getByRole('button',{name:'Add a wish',exact:true}).click()
 await page.getByLabel('Product name',{exact:true}).fill('Offline winter coat')
 await page.getByLabel('How much would you love it?').selectOption('really_want')
 await page.getByLabel('Gift preferences').fill('Large, forest green')
 await page.getByRole('button',{name:'Add to wishlist',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 const queued=await outbox(page)
 expect(queued[0].product).toMatchObject({priority:'really_want',gift_preferences:'Large, forest green',status:'active'})
 await page.reload()
 await page.getByLabel('Search your saved wishes').fill('forest green')
 await expect(page.locator('.product-card')).toContainText('Offline winter coat')
 await expect(page.locator('.product-card')).toContainText('Really want')
 await expect(page.getByRole('button',{name:'Quick edit Offline winter coat',exact:true})).toBeDisabled()
 for(const colorScheme of ['light','dark'] as const){
  await page.emulateMedia({colorScheme})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`/tmp/osk-wishes-${colorScheme}.png`,fullPage:true,animations:'disabled'})
 }
 await context.setOffline(false)
 await expect.poll(async()=> (await outbox(page)).length).toBe(0)
 expect(data.items[0]).toMatchObject({name:'Offline winter coat',priority:'really_want',gift_preferences:'Large, forest green',status:'active'})
})


test('duplicate-copy approval reuses its ID after a lost response and keeps the draft available',async({page})=>{
 const data=await setup(page)
 const destination='20000000-0000-4000-8000-000000000002'
 data.lists.push({...data.lists[0],id:destination,name:'Birthday'})
 data.items.push({id:'30000000-0000-4000-8000-000000000001',list_id:listId,name:'A northern mug',variant:'',category:'Other',notes:'',offers:[],msrp_cents:null,msrp_source_url:null,created_at:new Date().toISOString(),checked_at:null,last_attempt_at:null,refresh_status:'never'})
 await page.reload()
 await page.getByRole('button',{name:/Birthday/}).click()
 await page.getByRole('button',{name:'Add a wish',exact:true}).click()
 await page.getByLabel('Product name',{exact:true}).fill('A northern mug')
 data.state.dropTransferResponse=true
 await page.getByRole('button',{name:'Add to wishlist',exact:true}).click()
 await page.getByRole('button',{name:'Copy existing wish to this list',exact:true}).click()
 await expect(page.getByRole('button',{name:'Add to wishlist',exact:true})).toBeEnabled()
 expect(data.items.filter(i=>i.list_id===destination)).toHaveLength(1)
 await expect(page.getByLabel('Product name',{exact:true})).toHaveValue('A northern mug')
 await page.getByRole('button',{name:'Add to wishlist',exact:true}).click()
 await page.getByRole('button',{name:'Copy existing wish to this list',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 expect(data.transfers).toHaveLength(2)
 expect(data.transfers[0].items).toEqual(data.transfers[1].items)
 expect(data.items.filter(i=>i.list_id===destination)).toHaveLength(1)
 await expect(page.locator('.product-card')).toContainText('A northern mug')
})


test('personal targets and alerts reload offline without allowing writes, and never follow another account',async({page,context})=>{
 const data=await setup(page),now=new Date().toISOString()
 const itemId='30000000-0000-4000-8000-000000000099'
 const offer={retailer:'Bookshop',url:'https://shop.example.com/private-book',price_cents:2000,seller_type:'retailer',us_shipping:'unknown',availability:'unknown',shipping_note:'Shipping extra'}
 data.items.push({id:itemId,list_id:listId,name:'My private target book',variant:'Hardcover',category:'Books',notes:'',msrp_cents:null,msrp_source_url:null,offers:[offer],created_at:now,checked_at:now,last_attempt_at:now,refresh_status:'ok'})
 data.tracking.watches.push({id:'private-watch',user_id:owner,item_id:itemId,target_cents:2500,is_met:true,last_price_cents:2000,last_checked_at:now,created_at:now,updated_at:now})
 data.tracking.alerts.push({id:'private-alert',watch_id:'private-watch',user_id:owner,item_id:itemId,name:'My private target book',variant:'Hardcover',price_cents:2000,target_cents:2500,offer,observed_at:now,read_at:null})
 await page.reload()
 await expect(page.getByRole('link',{name:'Open price alerts',exact:true})).toContainText('1 price alert')
 await page.waitForFunction(()=>new Promise(resolve=>{
  const request=indexedDB.open('osk-offline-v1',1);request.onsuccess=()=>{const db=request.result;const query=db.transaction('meta').objectStore('meta').get('price-tracking:10000000-0000-4000-8000-000000000001');query.onsuccess=()=>{resolve(query.result?.alerts?.length===1);db.close()}}
 }))
 await context.setOffline(true)
 await page.goto('/tracking?tab=alerts')
 await expect(page.locator('.price-alert-row')).toContainText('My private target book')
 await expect(page.getByRole('button',{name:'Mark as read',exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'View wish',exact:true}).click()
 await expect(page.getByLabel('Target price in USD',{exact:true})).toHaveValue('25')
 await expect(page.getByLabel('Target price in USD',{exact:true})).toBeDisabled()
 await page.keyboard.press('Escape')
 await context.setOffline(false)
 await expect(page.getByRole('button',{name:'Mark as read',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Mark as read',exact:true}).click()
 expect(data.tracking.writes).toEqual([owner])
 data.lists.push({id:'other-list',owner_id:other,name:'Other account wishes',description:'',occasion:'everyday',created_at:now,share_token:null})
 await page.evaluate(value=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(value)),session(other))
 await page.reload()
 await expect(page.locator('.price-alert-row')).toHaveCount(0)
 await expect(page.getByRole('link',{name:'Open price alerts',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Tracking dashboard',exact:true}).click()
 await expect(page.getByText('My private target book',{exact:true})).toHaveCount(0)
 expect(data.tracking.writes).toEqual([owner])
})
