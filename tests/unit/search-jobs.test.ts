import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
import {runSearchJob,applyApprovedResearch,dispatchSearchJob} from '../../server/utils/search-jobs'
import {researchStage} from '../../server/utils/progressive-search'
vi.mock('../../server/utils/progressive-search',async original=>({...await original<typeof import('../../server/utils/progressive-search')>(),researchStage:vi.fn()}))
const product={name:'Book',variant:'Hardcover',category:'Books',notes:'',msrp_cents:null,msrp_source_url:null,offers:[]}
const initial={summary:'Found',products:[product],sources:[],warnings:[],retailer_checks:[],checked_at:'2026-10-30T12:00:00Z'}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
let rows:Record<string,any[]>
function fakeDb(){return {from:(table:string)=>{
 let changes:any,returning=false
 const filters:Array<(row:any)=>boolean>=[]
 const execute=()=>{
  const found=(rows[table]||[]).filter(row=>filters.every(filter=>filter(row)))
  if(changes)for(const row of found)Object.assign(row,structuredClone(changes))
  return {data:changes&&!returning?null:structuredClone(found),error:null}
 }
 const query:any={
  update:(value:any)=>{changes=value;return query},select:()=>{returning=true;return query},
  eq:(key:string,value:any)=>{filters.push(row=>key==='offers'?JSON.stringify(row[key])===value:row[key]===value);return query},
  is:(key:string,value:any)=>{filters.push(row=>row[key]===value);return query},
  maybeSingle:async()=>{const r=execute();return {...r,data:r.data?.[0]||null}},
  single:async()=>{const r=execute();return {...r,data:r.data?.[0]||null}},
  then:(resolve:any)=>Promise.resolve(execute()).then(resolve),
 };return query
 }} as unknown as SupabaseClient}
beforeEach(()=>{
 vi.clearAllMocks(); vi.stubEnv('PRODUCT_RESEARCH_MODE','ai')
 rows={product_search_jobs:[{id:'job',user_id:'owner',query:'A book',product_url:null,status:'queued',result:null,approved_item_id:null,approved_snapshot:null}],wish_lists:[{id:'list',owner_id:'owner'}],wish_items:[],list_members:[]}
})
describe('Durable research lifecycle',()=>{
 it('disables queued agents and rejects dispatch without making model or network calls', async () => {
  vi.stubEnv('PRODUCT_RESEARCH_MODE','scrape')
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  await runSearchJob(fakeDb(),'job')
  expect(rows.product_search_jobs![0].status).toBe('failed')
  expect(researchStage).not.toHaveBeenCalled()
  await expect(dispatchSearchJob(fakeDb(),'job')).rejects.toThrow('AI research is disabled')
  expect(fetcher).not.toHaveBeenCalled()
 })
 it('dispatches to the current deployment without redirects and requires asynchronous acceptance',async()=>{
  vi.stubEnv('URL','https://osk.example.com')
  vi.stubEnv('DEPLOY_URL','https://current--osk.netlify.app')
  vi.stubEnv('PRICE_REFRESH_SECRET','test-only')
  const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:202}))
  vi.stubGlobal('fetch',fetcher)
  await dispatchSearchJob(fakeDb(),'job')
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://current--osk.netlify.app/.netlify/functions/product-search-background')
  expect(fetcher.mock.calls[0]![1]).toMatchObject({redirect:'error',method:'POST'})
  fetcher.mockResolvedValue(new Response('<html>App shell</html>',{status:200}))
  await expect(dispatchSearchJob(fakeDb(),'job')).rejects.toThrow('not accepted')
 })
 it('publishes an approvable product while a retailer is still working and claims work only once',async()=>{
  let finishAmazon!:(value:any)=>void
  const amazon=new Promise(resolve=>{finishAmazon=resolve})
  vi.mocked(researchStage).mockImplementation(async(_query,task)=>task.id==='amazon'?await amazon as any:initial)
  const db=fakeDb(),running=runSearchJob(db,'job')
  await vi.waitFor(()=>expect(rows.product_search_jobs![0].result?.products[0]?.name).toBe('Book'))
  expect(rows.product_search_jobs![0].status).toBe('running')
  await runSearchJob(db,'job')
  expect(researchStage).toHaveBeenCalledTimes(3)
  finishAmazon(initial);await running
  expect(rows.product_search_jobs![0].status).toBe('completed')
 })
 it('keeps the identified product when both retailer checks fail',async()=>{
  vi.mocked(researchStage).mockImplementation(async(_query,task)=>{if(task.id!=='identify')throw new Error('timeout');return initial})
  await runSearchJob(fakeDb(),'job')
  expect(rows.product_search_jobs![0].status).toBe('completed')
  expect(rows.product_search_jobs![0].result.products[0].name).toBe('Book')
  expect(rows.product_search_jobs![0].result.warnings.join(' ')).toContain('could not finish')
 })
 it('does not overwrite edits made after early approval',async()=>{
  const snapshot={...product,id:'item',list_id:'list',checked_at:null,created_at:'now'}
  rows.wish_items=[{...snapshot,notes:'My later edit'}]
  const job={...rows.product_search_jobs![0],status:'completed',approved_item_id:'item',approved_snapshot:snapshot,result:{...initial,products:[{...product,offers:[{retailer:'Shop',url:'https://shop.example/book',price_cents:1000}]}]}}
  await applyApprovedResearch(fakeDb(),job)
  expect(rows.wish_items[0].notes).toBe('My later edit')
  expect(rows.wish_items[0].offers).toEqual([])
 })
 it('revokes background editing when the approving editor loses access',async()=>{
  const snapshot={...product,id:'item',list_id:'list',checked_at:null}
  rows.wish_items=[snapshot]
  rows.wish_lists=[{id:'list',owner_id:'different-owner'}]
  await applyApprovedResearch(fakeDb(),{...rows.product_search_jobs![0],status:'completed',approved_item_id:'item',approved_snapshot:snapshot,result:initial})
  expect(rows.wish_items[0].last_attempt_at).toBeUndefined()
 })
})
