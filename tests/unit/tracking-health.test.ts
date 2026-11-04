import {describe,expect,it} from 'vitest'
import type {WishItem} from '../../shared/types'
import {trackingHealth,trackingReason} from '../../shared/tracking-health'
const now=Date.parse('2026-11-04T12:00:00Z')
const item:WishItem={id:'item',list_id:'list',name:'A mug',variant:'Blue',category:'Home',notes:'Product link: https://shop.example.com/mug',offers:[],msrp_cents:null,msrp_source_url:null,checked_at:'2026-11-04T00:00:00Z',last_attempt_at:'2026-11-04T00:00:00Z',refresh_status:'ok',created_at:'2026-11-01T00:00:00Z'}
describe('Tracking health',()=>{
  it('distinguishes fresh observations from stale, failed and manual entries',()=>{
    expect(trackingHealth(item,now)).toBe('fresh')
    expect(trackingHealth({...item,checked_at:'2026-11-02T00:00:00Z'},now)).toBe('stale')
    expect(trackingHealth({...item,refresh_status:'failed'},now)).toBe('failed')
    expect(trackingHealth({...item,checked_at:null,refresh_status:'never'},now)).toBe('never')
    expect(trackingHealth({...item,checked_at:'invalid'},now)).toBe('stale')
  })
  it('prioritizes paused, unsynced and missing-link wishes without treating MSRP as a current price',()=>{
    expect(trackingHealth({...item,status:'received',refresh_status:'failed'},now)).toBe('paused')
    expect(trackingHealth({...item,pending_sync:true},now)).toBe('pending')
    expect(trackingHealth({...item,notes:'',msrp_cents:5000},now)).toBe('missing')
  })
  it('retains per-item failure explanations and does not reuse stale pre-edit diagnostics',()=>{
    const details={warnings:['This store blocked automated access.'],retailer_checks:[]}
    expect(trackingReason({...item,refresh_status:'failed',price_check_details:details})).toContain('blocked')
    expect(trackingReason({...item,refresh_status:'never',price_check_details:details})).toContain('Manual prices')
  })
})
