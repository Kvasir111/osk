import { test, expect, type Page } from '@playwright/test'
const code='ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'
const userId='10000000-0000-4000-8000-000000000001'
async function connected(page:Page,signedIn=true){
 await page.route('**/api/lists',route=>route.fulfill({json:{lists:[],memberships:[]}}))
 await page.route('**/api/searches',route=>route.fulfill({json:[]}))
 if(signedIn){
  const now=new Date().toISOString(),exp=Math.floor(Date.now()/1000)+3600
  const payload=Buffer.from(JSON.stringify({sub:userId,role:'authenticated',exp})).toString('base64url')
  const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:exp,user:{id:userId,email:'admin@example.com',email_confirmed_at:now,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:now}}
  await page.addInitScript(session=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(session)),session)
 }
 await page.route('**/*',async route=>{
  if(route.request().resourceType()!=='document')return route.fallback()
  const response=await route.fetch()
  const body=(await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""','supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"')
  return route.fulfill({response,body})
 })
}
test('admin can email invitations, generate a code, resend, and revoke on mobile',async({page})=>{
 await connected(page)
 const rows:any[]=[]
 let resends=0
 await page.route('**/api/account-invitations**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(request.method()==='GET')return route.fulfill({json:{can_invite:true,invitations:rows}})
  if(request.method()==='DELETE'){
   rows.find(row=>path.endsWith(row.id)).revoked_at=new Date().toISOString()
   return route.fulfill({json:{ok:true}})
  }
  if(path.endsWith('/resend')){resends++;return route.fulfill({json:{ok:true}})}
  const input=request.postDataJSON(),id=crypto.randomUUID()
  rows.unshift({id,kind:input.kind,recipient_email:input.email||null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+7*86400000).toISOString(),revoked_at:null,delivery_status:input.kind==='email'?'sent':'pending',sent_at:input.kind==='email'?new Date().toISOString():null})
  return route.fulfill({json:{id,...(input.kind==='code'?{code}:{})}})
 })
 await page.setViewportSize({width:390,height:844})
 await page.goto('/invitations')
 await page.getByLabel('Their email').fill('friend@example.com')
 await page.getByRole('button',{name:'Send invitation',exact:true}).click()
 await expect(page.locator('.invitations-page').getByRole('status')).toContainText('Invitation email sent')
 await expect(page.locator('.account-invitation-row')).toContainText('friend@example.com')
 await page.getByRole('button',{name:'Resend email'}).click()
 expect(resends).toBe(1)
 await page.getByRole('button',{name:'Generate invitation code'}).click()
 await expect(page.getByLabel('Invitation code',{exact:true})).toHaveValue(code)
 await expect(page.getByRole('button',{name:'Copy invitation link'})).toBeVisible()
 await page.locator('.account-invitation-row').filter({hasText:'Invitation code'}).getByRole('button',{name:'Revoke',exact:true}).click()
 await expect(page.locator('.account-invitation-row').filter({hasText:'Invitation code'})).toContainText('Revoked')
 await page.emulateMedia({colorScheme:'dark'})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:'/tmp/osk-invitations-mobile.png',fullPage:true})
})
test('non-admin accounts cannot open the invitation controls',async({page})=>{
 await connected(page)
 await page.route('**/api/account-invitations',route=>route.fulfill({json:{can_invite:false,invitations:[]}}))
 await page.goto('/invitations')
 await expect(page.getByText('Your account can’t create account invitations.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Send invitation',exact:true})).toHaveCount(0)
})
test('code acceptance keeps code out of the URL and requires an email link',async({page})=>{
 await connected(page,false)
 let tries=0
 await page.route('**/api/account-invitations/redeem',route=>{
  expect(route.request().postDataJSON()).toEqual({code:code.replaceAll('-',''),email:'friend@example.com'})
  tries++
  return tries===1?route.fulfill({status:400,json:{statusMessage:'This invitation is unavailable.'}}):route.fulfill({json:{ok:true}})
 })
 await page.goto(`/join#code=${code}`)
 await expect(page.getByLabel('Invitation code',{exact:true})).toHaveValue(code)
 await expect(page).toHaveURL(/\/join$/)
 await page.getByLabel('Your email',{exact:true}).fill('friend@example.com')
 await page.getByRole('button',{name:'Accept invitation',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('unavailable')
 await page.getByRole('button',{name:'Accept invitation',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('Check your inbox')
 await expect(page.getByLabel('Invitation code',{exact:true})).toHaveCount(0)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
