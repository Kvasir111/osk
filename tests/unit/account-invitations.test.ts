import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { accountInvitationRequest, canInviteAccounts, deliverInvitation, generateInviteCode, hashInviteCode, invitationRedirect, redeemAccountInvitation } from '../../server/utils/account-invitations'
import { adminDatabase } from '../../server/utils/database'
import { invitationCode } from '../../shared/account-invitations'
vi.mock('h3', async original => ({ ...await original<typeof import('h3')>(), readBody: vi.fn(async (event: any) => event.body) }))
vi.mock('../../server/utils/database', () => ({ adminDatabase: vi.fn(), databaseConfig: () => ({url:'https://project.supabase.co',key:'public'}), dbResult: ({data,error}: any) => { if(error) throw error; return data } }))
vi.mock('@supabase/supabase-js', () => ({createClient: vi.fn()}))
const id='10000000-0000-4000-8000-000000000001'
const actor={id,email:'admin@example.com',email_confirmed_at:'2026-01-01'} as User
const event=(method:string,body={})=>({method,body}) as unknown as H3Event
const mutations:any[]=[]
function mockAdmin({reserved=true, row={id,recipient_email:'friend@example.com'} as any, inviteError=null as any}={}) {
 const query:any={then:(resolve:any)=>Promise.resolve({data:row,error:null}).then(resolve)}
 for(const op of ['select','eq','order','limit','update'])query[op]=(...args:any[])=>{mutations.push({op,args});return query}
 query.maybeSingle=async()=>({data:row,error:null})
 return {from:vi.fn(()=>query),rpc:vi.fn(async(name:string)=>({data:name==='reserve_account_invitation'?reserved:[row],error:null})),auth:{admin:{inviteUserByEmail:vi.fn(async()=>({error:inviteError}))}}} as unknown as SupabaseClient
}
beforeEach(()=>{vi.clearAllMocks();mutations.length=0;vi.stubEnv('INVITATION_ADMIN_EMAILS','admin@example.com');vi.stubEnv('URL','https://osk.example.com')})
describe('Account invitation authorization and delivery',()=>{
 it('accepts only a verified, server-configured admin email',()=>{
  expect(canInviteAccounts(actor)).toBe(true)
  expect(canInviteAccounts({...actor,email_confirmed_at:undefined})).toBe(false)
  expect(canInviteAccounts({...actor,email:'outsider@example.com',user_metadata:{admin:true}})).toBe(false)
  vi.stubEnv('INVITATION_ADMIN_EMAILS','');expect(canInviteAccounts(actor)).toBe(false)
 })
 it('blocks non-admin writes before privileged access',async()=>{
  await expect(accountInvitationRequest(event('POST',{kind:'code'}),['account-invitations'],{...actor,email:'other@example.com'})).rejects.toMatchObject({statusCode:403})
  expect(adminDatabase).not.toHaveBeenCalled()
 })
 it('generates random normalized codes and stores only a hash',async()=>{
  const code=generateInviteCode();expect(invitationCode.parse(code)).toHaveLength(24)
  expect(hashInviteCode(code)).toBe(hashInviteCode(code.toLowerCase().replaceAll('-',' ')))
  expect(new Set(Array.from({length:50},generateInviteCode)).size).toBe(50)
  const admin=mockAdmin();vi.mocked(adminDatabase).mockReturnValue(admin)
  const result=await accountInvitationRequest(event('POST',{kind:'code'}),['account-invitations'],actor) as any
  expect(result.code).toBeTruthy()
  expect(admin.rpc).toHaveBeenCalledWith('create_account_invitation',expect.objectContaining({actor:id,token_hash:hashInviteCode(result.code),email_address:null}))
  expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
 })
 it('does not send mail for an expired, bound, revoked, or rate-limited reservation',async()=>{
  const admin=mockAdmin({reserved:false})
  await expect(deliverInvitation(admin,id,'friend@example.com',invitationRedirect())).rejects.toMatchObject({statusCode:400})
  expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
 })
 it('redirects new invitees to their profile and records successful delivery',async()=>{
  const admin=mockAdmin()
  await deliverInvitation(admin,id,'friend@example.com',invitationRedirect())
  expect(admin.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('friend@example.com',{redirectTo:'https://osk.example.com/login?next=%2Fprofile'})
  expect(mutations).toContainEqual({op:'update',args:[expect.objectContaining({delivery_status:'sent'})]})
 })
 it('uses ordinary sign-in for existing accounts without enabling public signups',async()=>{
  const signInWithOtp=vi.fn(async()=>({error:null}))
  vi.mocked(createClient).mockReturnValue({auth:{signInWithOtp}} as any)
  const admin=mockAdmin({inviteError:{code:'email_exists'}})
  await deliverInvitation(admin,id,'friend@example.com',invitationRedirect())
  expect(signInWithOtp).toHaveBeenCalledWith({email:'friend@example.com',options:{shouldCreateUser:false,emailRedirectTo:invitationRedirect()}})
 })
 it('records a failed delivery without exposing auth error details',async()=>{
  const admin=mockAdmin({inviteError:{code:'smtp_error',message:'internal credential'}})
  await expect(deliverInvitation(admin,id,'friend@example.com',invitationRedirect())).rejects.toMatchObject({statusCode:502,statusMessage:expect.not.stringContaining('credential')})
  expect(mutations).toContainEqual({op:'update',args:[{delivery_status:'failed'}]})
 })
 it('rejects malformed and missing codes without sending an email',async()=>{
  await expect(redeemAccountInvitation(event('POST',{code:'bad',email:'friend@example.com'}))).rejects.toBeTruthy()
  expect(adminDatabase).not.toHaveBeenCalled()
  const admin=mockAdmin({row:null});vi.mocked(adminDatabase).mockReturnValue(admin)
  await expect(redeemAccountInvitation(event('POST',{code:generateInviteCode(),email:'friend@example.com'}))).rejects.toMatchObject({statusCode:400})
  expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
 })
 it('requires creator ownership before resending or revoking an invitation',async()=>{
  const admin=mockAdmin({row:null});vi.mocked(adminDatabase).mockReturnValue(admin)
  await expect(accountInvitationRequest(event('DELETE'),['account-invitations',id],actor)).rejects.toMatchObject({statusCode:404})
  expect(mutations).toContainEqual({op:'eq',args:['created_by',id]})
  expect(admin.rpc).not.toHaveBeenCalled()
 })
})
