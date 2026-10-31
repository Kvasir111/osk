import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { familyRequest } from '../../server/utils/families'
import { adminDatabase } from '../../server/utils/database'
vi.mock('h3', async original => ({ ...await original<typeof import('h3')>(), readBody: vi.fn(async (event: any) => event.body) }))
vi.mock('../../server/utils/database', () => ({ adminDatabase: vi.fn(), dbResult: ({data,error}: any) => { if(error) throw error; return data } }))
const familyId = '10000000-0000-4000-8000-000000000001'
const owner = '20000000-0000-4000-8000-000000000001'
const member = '20000000-0000-4000-8000-000000000002'
const other = '20000000-0000-4000-8000-000000000003'
const calls: {table:string; operation:string; value?:unknown}[] = []
function fakeDb(results: Record<string, unknown>) {
  return { from: (table: string) => {
    const result = { data: results[table] ?? null, error: null }
    const query: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) }
    for (const op of ['select','eq','gt','in','order','insert','upsert','delete']) query[op] = (value: unknown) => { calls.push({table, operation:op,value}); return query }
    query.single = query.maybeSingle = () => Promise.resolve(result)
    return query
  } } as unknown as SupabaseClient
}
const event = (method: string, body = {}) => ({ method, body }) as unknown as H3Event
const user = (id: string) => ({id}) as User
beforeEach(() => { calls.length=0; vi.clearAllMocks() })
describe('Family server authorization', () => {
  it('does not use privileged reads for an inaccessible family', async () => {
    await expect(familyRequest(event('GET'), ['families',familyId], fakeDb({}), user(other))).rejects.toMatchObject({statusCode:404})
    expect(adminDatabase).not.toHaveBeenCalled()
  })
  it('blocks ordinary members from removing others or creating/revoking invitations', async () => {
    const db = fakeDb({families:{id:familyId,owner_id:owner}})
    for (const [action, method, body] of [['members','DELETE',{user_id:other}],['invite','POST',{}],['invite','DELETE',{}]] as const) {
      await expect(familyRequest(event(method,body), ['families',familyId,action], db, user(member))).rejects.toMatchObject({statusCode:403})
    }
    expect(adminDatabase).not.toHaveBeenCalled()
  })
  it('prevents the organizer from leaving and orphaning a hub', async () => {
    await expect(familyRequest(event('DELETE',{user_id:owner}), ['families',familyId,'members'], fakeDb({families:{id:familyId,owner_id:owner}}),user(owner))).rejects.toMatchObject({statusCode:400})
    expect(adminDatabase).not.toHaveBeenCalled()
  })
  it('allows a member to leave and removes their shares before their membership', async () => {
    vi.mocked(adminDatabase).mockReturnValue(fakeDb({wish_lists:[{id:'list'}]}))
    await expect(familyRequest(event('DELETE',{user_id:member}), ['families',familyId,'members'], fakeDb({families:{id:familyId,owner_id:owner}}),user(member))).resolves.toEqual({ok:true})
    const mutations=calls.filter(c=>c.operation==='delete')
    expect(mutations.map(c=>c.table)).toEqual(['family_lists','family_members'])
  })
  it('does not create membership when an invitation is expired or revoked', async () => {
    vi.mocked(adminDatabase).mockReturnValue(fakeDb({}))
    await expect(familyRequest(event('POST'),['family-join',familyId],fakeDb({}),user(member))).rejects.toMatchObject({statusCode:404})
    expect(calls.some(c=>c.operation==='upsert')).toBe(false)
  })
})
