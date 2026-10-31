import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PendingAddition } from '../../app/utils/offline-storage'
import { overlayAdditions, syncProblem } from '../../shared/offline'
import { createOfflineItem, createOfflineList } from '../../server/utils/offline-create'
import { writeItem } from '../../server/utils/item-write'
vi.mock('../../server/utils/item-write',()=>({writeItem:vi.fn()}))
const product={name:'Offline book',variant:'Hardcover',notes:'',category:'Books',offers:[],msrp_cents:null,msrp_source_url:null}
const list={id:'list',owner_id:'owner',name:'Wishes',description:'',occasion:'everyday' as const,created_at:'2026-01-01',share_token:null}
function existingDb(row:unknown,duplicate=true){
 const filters:unknown[][]=[]
 const result={data:row,error:null}
 const query:any={select:()=>query,eq:(...args:unknown[])=>{filters.push(args);return query},maybeSingle:async()=>result,insert:()=>query,single:async()=>duplicate?{data:null,error:{code:'23505'}}:result}
 return {db:{from:()=>query} as unknown as SupabaseClient,filters}
}
describe('Offline additions',()=>{
 it('overlays durable additions without duplicating records already returned by the server',()=>{
  const additions:PendingAddition[]=[{id:'new-list',accountId:'owner',kind:'list',product:{name:'Later',description:'',occasion:'everyday'},status:'pending',createdAt:'2026-01-02'}, {id:'new-item',accountId:'owner',kind:'item',listId:'new-list',product,status:'blocked',error:'No access',createdAt:'2026-01-02'}]
  const first=overlayAdditions([list],[],additions)
  expect(first.lists).toHaveLength(2);expect(first.items[0]).toMatchObject({pending_sync:true,checked_at:null,list_id:'new-list'})
  const retried=overlayAdditions(first.lists,first.items,additions)
  expect(retried.items).toHaveLength(1);expect(retried.lists).toHaveLength(2)
 })
 it('uses client item ids for safe retries and scopes duplicate reads to the destination list',async()=>{
  vi.mocked(writeItem).mockResolvedValue({data:null,error:{code:'23505'}} as any)
  const {db,filters}=existingDb({id:'stable-id',list_id:'list',...product})
  const result=await createOfflineItem(db,'stable-id','list',product)
  expect(result.id).toBe('stable-id')
  expect(filters).toEqual([['id','stable-id'],['list_id','list']])
  expect(writeItem).toHaveBeenCalledWith(db,expect.objectContaining({id:'stable-id',list_id:'list',checked_at:null,refresh_status:'never'}))
 })
 it('does not accept a duplicate item hidden by RLS or in a different list',async()=>{
  vi.mocked(writeItem).mockResolvedValue({data:null,error:{code:'23505'}} as any)
  await expect(createOfflineItem(existingDb(null).db,'stable-id','other',product)).rejects.toMatchObject({statusCode:409})
 })
 it('does not turn an RLS failure into a duplicate success',async()=>{
  vi.mocked(writeItem).mockResolvedValue({data:null,error:{code:'42501'}} as any)
  const {db,filters}=existingDb({id:'stable-id'})
  await expect(createOfflineItem(db,'stable-id','list',product)).rejects.toBeTruthy()
  expect(filters).toEqual([])
 })
 it('scopes duplicate list retries to the authenticated owner',async()=>{
  const {db,filters}=existingDb(list)
  await expect(createOfflineList(db,'list','owner',list)).resolves.toEqual(list)
  expect(filters).toEqual([['id','list'],['owner_id','owner']])
  await expect(createOfflineList(existingDb(null).db,'list','other',list)).rejects.toMatchObject({statusCode:409})
 })
 it('explains authorization and missing-list conflicts while preserving the addition',()=>{
  expect(syncProblem(401)).toContain('Sign in again')
  expect(syncProblem(403)).toContain('permission')
  expect(syncProblem(404)).toContain('no longer available')
 })
})
