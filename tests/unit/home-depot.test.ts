import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WishItem } from '../../shared/types'
import { checkHomeDepot, homeDepotEnabled, homeDepotId, homeDepotOffer } from '../../server/utils/home-depot'

const url='https://www.homedepot.com/p/Husky-Shelf/333882212'
const item={name:'Husky shelving unit',variant:'Red',category:'Home',offers:[],notes:'',msrp_cents:null,msrp_source_url:null} as unknown as WishItem
const record={product_id:'333882212',url,product_name:'Shelving unit',manufacturer:'Husky',variation:{value:'Red'},final_price:'199',initial_price:'219',currency:'USD',zipcode:'55437',in_stock:true,add_to_cart:false,seller_url:'https://www.homedepot.com'}
const update=vi.fn(()=>({eq:vi.fn().mockResolvedValue({error:null})}))
const db={rpc:vi.fn(),from:vi.fn(()=>({update}))} as unknown as SupabaseClient
const fetchMock=vi.fn()
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('BRIGHTDATA_HOME_DEPOT_ENABLED','true');vi.stubEnv('BRIGHTDATA_API_KEY','test-only');vi.stubEnv('HOME_DEPOT_ZIPCODE','55437');vi.stubEnv('BRIGHTDATA_MONTHLY_LIMIT','3000');vi.stubGlobal('fetch',fetchMock)
})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
describe('Home Depot background provider',()=>{
  it('requires explicit opt-in and accepts only exact HTTPS Home Depot products',()=>{
    vi.stubEnv('BRIGHTDATA_HOME_DEPOT_ENABLED','')
    expect(homeDepotEnabled()).toBe(false)
    expect(homeDepotId(url)).toBe('333882212')
    for(const bad of ['http://www.homedepot.com/p/x/333882212','https://homedepot.com.evil.test/p/x/333882212','https://user@homedepot.com/p/x/333882212','https://homedepot.com/s/shelves'])expect(homeDepotId(bad)).toBeNull()
  })
  it('maps USD cents without treating a retailer reference price as MSRP',async()=>{
    vi.mocked(db.rpc).mockResolvedValue({data:{start:false,job:{id:'job',result:record,checked_at:'2026-11-04T12:00:00Z'}},error:null} as any)
    const result=await checkHomeDepot(db,item,url)
    expect(result.products[0]?.offers[0]?.price_cents).toBe(19900)
    expect(result.products[0]?.msrp_cents).toBeNull()
    expect(result.checked_at).toBe('2026-11-04T12:00:00Z')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects wrong products, variants, ZIPs, conditional prices and unavailable products',()=>{
    for(const changed of [{product_id:'333882213'},{url:url.replace('333882212','333882213')},{variation:{value:'Blue'}},{zipcode:'00000'},{currency:'CAD'},{final_price:'199.999'},{in_stock:false},{add_to_cart:true},{promotion_fulltext:'Save with a credit card'},{seller_url:'https://another-seller.example.com'},{seller_url:null}])
      expect(()=>homeDepotOffer({...record,...changed},url,item,'55437')).toThrow()
  })
  it('does not contact the provider when quota or schema protection is unavailable',async()=>{
    for(const response of [{data:null,error:null},{data:null,error:{message:'missing RPC'}}]){
      vi.mocked(db.rpc).mockResolvedValue(response as any)
      await expect(checkHomeDepot(db,item,url)).rejects.toThrow()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('starts just one selected-product job, saves its snapshot and retrieves one result',async()=>{
    vi.mocked(db.rpc).mockResolvedValue({data:{start:true,job:{id:'job'}},error:null} as any)
    fetchMock.mockResolvedValueOnce(Response.json({snapshot_id:'sd_test'})).mockResolvedValueOnce(Response.json({status:'ready'})).mockResolvedValueOnce(Response.json([record]))
    await checkHomeDepot(db,item,url)
    const request=fetchMock.mock.calls[0]!
    expect(JSON.parse(request[1].body)).toEqual({input:[{url,zipcode:'55437',all_variations:false}],limit_per_input:1})
    expect(update).toHaveBeenCalledWith({snapshot_id:'sd_test'})
    expect(update).toHaveBeenCalledWith(expect.objectContaining({result:record}))
    expect(fetchMock.mock.calls.filter(call=>call[1].method==='POST')).toHaveLength(1)
  })
  it('resumes saved snapshots without starting another collection and never retries uncertain POSTs',async()=>{
    vi.mocked(db.rpc).mockResolvedValue({data:{start:false,job:{id:'job',snapshot_id:'sd_existing'}},error:null} as any)
    fetchMock.mockResolvedValueOnce(Response.json({status:'ready'})).mockResolvedValueOnce(Response.json([record]))
    await checkHomeDepot(db,item,url)
    expect(fetchMock.mock.calls.every(call=>call[1].method==='GET')).toBe(true)
    fetchMock.mockReset().mockRejectedValue(new Error('Network timeout'))
    vi.mocked(db.rpc).mockResolvedValue({data:{start:true,job:{id:'other'}},error:null} as any)
    await expect(checkHomeDepot(db,item,url)).rejects.toThrow('Network timeout')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
