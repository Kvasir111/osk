import {test,expect} from '@playwright/test'

test('partial research can be approved and continues polling after the dialog closes',async({page})=>{
 const userId='10000000-0000-4000-8000-000000000001',listId='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001'
 const now=new Date().toISOString()
 const product={name:'A researched book',variant:'Hardcover',category:'Books',notes:'',msrp_cents:2000,msrp_source_url:'https://publisher.example/book',offers:[{retailer:'Bookshop',url:'https://shop.example/book',price_cents:1000,seller_type:'retailer',us_shipping:'unknown',availability:'unknown',shipping_note:''}]}
 const list={id:listId,owner_id:userId,name:'Research wishes',description:'',occasion:'everyday',share_token:null,created_at:now}
 const job:any={id:jobId,user_id:userId,query:'Book',product_url:'https://shop.example/book',status:'running',stages:[{id:'identify',label:'Product listing',status:'completed'},{id:'amazon',label:'Amazon',status:'running'},{id:'retailers',label:'Other retailers',status:'running'}],result:{summary:'Product identified.',products:[product],sources:[],warnings:['Comparison is still running.'],retailer_checks:[],checked_at:now},approved_item_id:null,approved_snapshot:null,created_at:now,updated_at:now,finished_at:null,error_message:null}
 let started=false,complete=false,item:any=null,approvals=0
 const payload=Buffer.from(JSON.stringify({sub:userId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')
 const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId,aud:'authenticated',role:'authenticated',email:'qa@example.com',app_metadata:{provider:'email'},user_metadata:{display_name:'QA'},created_at:now}}
 await page.addInitScript(session=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(session)),session)
 await page.route('**/*',async route=>{
  if(route.request().resourceType()!=='document')return route.continue()
  const response=await route.fetch()
  const body=(await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""','supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"')
  return route.fulfill({response,body})
 })
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(path==='/api/profile')return route.fulfill({json:{display_name:'QA',avatar_url:null,email:'qa@example.com'}})
  if(path==='/api/lists')return route.fulfill({json:{lists:[list],memberships:[],user_id:userId}})
  if(path===`/api/lists/${listId}/items`&&request.method()==='POST'){
   const body=request.postDataJSON();expect(body.search_id).toBe(jobId);approvals++
   item={...body.product,id:'item',list_id:listId,created_at:now,checked_at:body.checked_at,last_attempt_at:body.checked_at,refresh_status:'ok',price_check_details:body.price_check_details}
   job.approved_item_id='item';return route.fulfill({json:item})
  }
  if(path===`/api/lists/${listId}/items`)return route.fulfill({json:item?[item]:[]})
  if(path==='/api/searches'&&request.method()==='POST'){
   expect(request.postDataJSON().url).toBe('https://shop.example/book');started=true
   return route.fulfill({json:{...job,status:'queued',result:null}})
  }
  if(path==='/api/searches')return route.fulfill({json:started?[job]:[]})
  if(path===`/api/searches/${jobId}`){
   if(complete){
    job.status='completed';job.stages=job.stages.map((stage:any)=>({...stage,status:'completed'}));job.updated_at=new Date().toISOString()
    job.result={...job.result,products:[{...product,offers:[{...product.offers[0],price_cents:500}]}],warnings:[]}
    if(item)item={...item,offers:job.result.products[0].offers}
   }
   return route.fulfill({json:job})
  }
  return route.fulfill({status:404,json:{statusMessage:'Mock route not found'}})
 })
 await page.goto('/capture?url=https%3A%2F%2Fshop.example%2Fbook')
 await page.getByRole('button',{name:'Preview product & prices'}).click()
 await expect(page.getByRole('heading',{name:'A researched book',exact:true})).toBeVisible({timeout:10000})
 await expect(page.getByRole('region',{name:'Search progress'})).toContainText('Checking…')
 expect(approvals).toBe(0)
 await page.getByRole('button',{name:'Approve & add to list'}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 expect(approvals).toBe(1)
 await page.getByRole('link',{name:'View your list'}).click()
 complete=true
 await expect(page.locator('.product-card .price-row')).toContainText('$5',{timeout:12000})
 await expect(page.getByRole('complementary',{name:'Product research'})).toContainText('Price checks finished')
 await page.reload()
 await page.getByRole('link',{name:'View comparison'}).click()
 await expect(page.getByRole('button',{name:'Already saved',exact:true})).toBeDisabled()
 expect(approvals).toBe(1)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:'/tmp/osk-progressive-search-mobile.png',fullPage:true})
})
