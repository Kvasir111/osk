import { test, expect, type Page } from '@playwright/test'
const owner='10000000-0000-4000-8000-000000000001'
function session(){
  const now=new Date().toISOString(),exp=Math.floor(Date.now()/1000)+3600
  const payload=Buffer.from(JSON.stringify({sub:owner,role:'authenticated',exp})).toString('base64url')
  return {access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.test`,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:exp,
    user:{id:owner,email:'qa@example.com',email_confirmed_at:now,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{display_name:'QA'},created_at:now}}
}
async function connected(page:Page,signedIn=false){
  const current=session(),state={passwords:[] as string[],signups:0,signins:0,recovery:[] as string[],links:[] as string[],rejectLogin:false,rejectPassword:false}
  if(signedIn)await page.addInitScript(value=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(value)),current)
  await page.route('**/*',async route=>{
    if(route.request().resourceType()!=='document')return route.fallback()
    const response=await route.fetch()
    return route.fulfill({response,body:(await response.text()).replace('supabaseUrl:"",supabasePublishableKey:""','supabaseUrl:"https://qa.supabase.co",supabasePublishableKey:"sb_publishable_test_only"')})
  })
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/profile')return route.fulfill({json:{display_name:'QA',email:'qa@example.com',avatar_url:null}})
    if(path==='/api/lists')return route.fulfill({json:{lists:[],memberships:[],user_id:owner}})
    if(path==='/api/research-config')return route.fulfill({json:{ai_enabled:false}})
    return route.fulfill({json:[]})
  })
  await page.route('https://qa.supabase.co/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method()
    if(url.pathname.endsWith('/signup'))state.signups++
    if(url.pathname.endsWith('/token')&&url.searchParams.get('grant_type')==='password'){
      state.signins++
      expect(request.postDataJSON()).toMatchObject({email:'qa@example.com',password:'test-only-unique-passphrase'})
      if(state.rejectLogin)return route.fulfill({status:400,json:{code:'invalid_credentials',msg:'Invalid login credentials'}})
      return route.fulfill({json:current})
    }
    if(url.pathname.endsWith('/recover')){
      expect(request.postDataJSON().email).toBe('qa@example.com')
      state.recovery.push(url.searchParams.get('redirect_to')||'')
      return route.fulfill({json:{}})
    }
    if(url.pathname.endsWith('/otp')){
      expect(request.postDataJSON()).toMatchObject({email:'qa@example.com',create_user:false})
      state.links.push(url.searchParams.get('redirect_to')||'')
      return route.fulfill({json:{}})
    }
    if(url.pathname.endsWith('/user')){
      if(method==='PUT'){
        state.passwords.push(request.postDataJSON().password)
        if(state.rejectPassword)return route.fulfill({status:422,json:{error_code:'weak_password',msg:'Weak password'}})
      }
      return route.fulfill({json:current.user})
    }
    return route.fulfill({status:400,json:{code:'test_only',msg:'Test auth only'}})
  })
  return {state,current}
}
test('password sign-in handles invalid credentials and preserves the login return path without signup',async({page})=>{
  const {state}=await connected(page)
  state.rejectLogin=true
  await page.goto('/login?next=/profile')
  await page.getByLabel('Your email',{exact:true}).fill('qa@example.com')
  await page.getByLabel('Password',{exact:true}).fill('test-only-unique-passphrase')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Check your email and password')
  await expect(page.getByLabel('Password',{exact:true})).toHaveValue('')
  state.rejectLogin=false
  await page.getByLabel('Password',{exact:true}).fill('test-only-unique-passphrase')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await expect(page).toHaveURL(/\/profile$/)
  expect(state.signins).toBe(2);expect(state.signups).toBe(0)
})
test('magic links and password-reset emails use the current origin and preserve shared capture paths',async({page})=>{
  const {state}=await connected(page)
  const next='/capture?url=https%3A%2F%2Fshop.example.com%2Fbook'
  await page.goto('/login?next='+encodeURIComponent(next))
  await page.getByLabel('Your email',{exact:true}).fill('qa@example.com')
  await page.getByRole('button',{name:'Use an email sign-in link',exact:true}).click()
  await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('If this email has an account')
  let redirect=new URL(state.links[0]!)
  expect(redirect.origin).toBe('http://127.0.0.1:3210');expect(redirect.searchParams.get('next')).toBe(next)
  await page.getByRole('button',{name:'Set or reset your password',exact:true}).click()
  await page.getByRole('button',{name:'Email me a password-reset link',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('password-reset link')
  redirect=new URL(state.recovery[0]!)
  expect(redirect.pathname).toBe('/login');expect(redirect.searchParams.get('mode')).toBe('recovery');expect(redirect.searchParams.get('next')).toBe(next)
  expect(state.signups).toBe(0)
})
test('recovery callbacks stay on the password form, clear tokens, and require matching passwords',async({page})=>{
  const {state,current}=await connected(page)
  const fragment=new URLSearchParams({access_token:current.access_token,refresh_token:current.refresh_token,expires_in:'3600',token_type:'bearer',type:'recovery'})
  await page.goto('/login?mode=recovery&next=/profile#'+fragment)
  await expect(page.getByLabel('New password',{exact:true})).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  await page.getByLabel('New password',{exact:true}).fill('test-only-unique-passphrase')
  await page.getByLabel('Confirm password',{exact:true}).fill('different-test-passphrase')
  await page.getByRole('button',{name:'Save password',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('don’t match')
  expect(state.passwords).toHaveLength(0)
  await page.getByLabel('Confirm password',{exact:true}).fill('test-only-unique-passphrase')
  state.rejectPassword=true
  await page.getByRole('button',{name:'Save password',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('security requirements')
  state.rejectPassword=false
  await page.getByRole('button',{name:'Save password',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('password has been saved')
  await expect(page).toHaveURL(/\/login\?mode=recovery/)
  await page.getByRole('link',{name:'Continue to Ósk',exact:true}).click()
  await expect(page).toHaveURL(/\/profile$/)
  expect(state.passwords).toEqual(['test-only-unique-passphrase','test-only-unique-passphrase'])
})
test('expired recovery links cannot update passwords and allow requesting a fresh link',async({page})=>{
  const {state}=await connected(page)
  await page.goto('/login?mode=recovery#error=access_denied&error_code=otp_expired&type=recovery')
  await expect(page.getByRole('alert')).toContainText('expired')
  expect(new URL(page.url()).hash).toBe('')
  await expect(page.getByLabel('New password',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Request another reset link',exact:true}).click()
  await page.getByLabel('Your email',{exact:true}).fill('qa@example.com')
  await page.getByRole('button',{name:'Email me a password-reset link',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('password-reset link')
  expect(state.passwords).toHaveLength(0)
})
test('a recovery callback at the site root opens password settings instead of the wishlist',async({page})=>{
  const {current}=await connected(page)
  const fragment=new URLSearchParams({access_token:current.access_token,refresh_token:current.refresh_token,expires_in:'3600',token_type:'bearer',type:'recovery'})
  await page.goto('/#'+fragment)
  await expect(page).toHaveURL(/\/login\?mode=recovery$/)
  await expect(page.getByLabel('New password',{exact:true})).toBeVisible()
})
test('normal magic-link callbacks preserve the return path and reject external destinations',async({page})=>{
  const {current}=await connected(page)
  const fragment=new URLSearchParams({access_token:current.access_token,refresh_token:current.refresh_token,expires_in:'3600',token_type:'bearer',type:'magiclink'})
  await page.goto('/login?next='+encodeURIComponent('//untrusted.example.com')+'#'+fragment)
  await expect(page).toHaveURL('http://127.0.0.1:3210/')
  await page.goto('/login?next=/profile')
  await expect(page).toHaveURL(/\/profile$/)
})
test('existing invited users can set a password from their profile on mobile in both themes',async({page})=>{
  const {state}=await connected(page,true)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/profile')
  const form=page.getByRole('region',{name:'Password settings',exact:true})
  for(const colorScheme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme})
    await form.scrollIntoViewIfNeeded()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await form.screenshot({path:test.info().outputPath(`password-settings-${colorScheme}.png`)})
  }
  await page.getByLabel('New password',{exact:true}).fill('test-only-unique-passphrase')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Confirm password',{exact:true})).toBeFocused()
  await page.keyboard.type('test-only-unique-passphrase')
  await page.keyboard.press('Tab');await page.keyboard.press('Enter')
  await expect(form.getByRole('status')).toContainText('password has been saved')
  await expect(page.getByLabel('New password',{exact:true})).toHaveValue('')
  expect(state.passwords).toHaveLength(1)
})
