import type { SupabaseClient } from '@supabase/supabase-js'
import type { Offer, SearchResult, WishItem } from '../../shared/types'
import { trackingLinks } from '../../shared/tracking'
import { identityMatches, priceCents } from './product-scraper'

export class HomeDepotCheckError extends Error {}

const api = 'https://api.brightdata.com/datasets/v3/'
const dataset = 'gd_lmusivh019i7g97q2n'
export function homeDepotId(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !/^(www\.)?homedepot\.com$/.test(url.hostname) || url.port || url.username || url.password) return null
    return url.pathname.match(/^\/p\/[^/]+\/(\d{9})\/?$/)?.[1] || null
  } catch { return null }
}
export function homeDepotEnabled() {
  return process.env.BRIGHTDATA_HOME_DEPOT_ENABLED === 'true' && !!process.env.BRIGHTDATA_API_KEY && /^\d{5}$/.test(process.env.HOME_DEPOT_ZIPCODE || '')
}
export function homeDepotLink(item: WishItem) { return trackingLinks(item).find(url => homeDepotId(url)) }
export function homeDepotOffer(record: any, url: string, item: WishItem, zipcode: string): Offer {
  if (!record || typeof record !== 'object') throw new HomeDepotCheckError('Home Depot returned no product details.')
  const id = homeDepotId(url)
  const cents = priceCents(record.final_price)
  const variation = record.variation?.value || ''
  if (!id || String(record.product_id) !== id || homeDepotId(record.url) !== id || record.zipcode !== zipcode
    || record.currency !== 'USD' || cents === null || record.add_to_cart !== false || record.discontinued === true
    || record.in_stock !== true || typeof record.product_name !== 'string'
    || typeof record.seller_url !== 'string' || !/^https:\/\/(?:www\.)?homedepot\.com\/?$/.test(record.seller_url)
    || !identityMatches(item, `${record.manufacturer || ''} ${record.product_name}`, variation))
    throw new HomeDepotCheckError('Home Depot did not verify an available price for this exact product and variant.')
  // Conditional discounts are not a generally available checkout price.
  if (record.promotion_fulltext && /credit|card|member|coupon|code|subscribe|subscription|rebate|bulk|minimum|buy\s+\d/i.test(record.promotion_fulltext))
    throw new HomeDepotCheckError('Home Depot reported a conditional promotion. Keep this price manual until verified.')
  return { retailer: 'The Home Depot', url, price_cents: cents, seller_type: 'retailer', us_shipping: 'unknown', availability: 'in_stock',
    shipping_note: `Delivery ZIP requested: ${zipcode}${record.store_name ? ` · Provider store: ${String(record.store_name).slice(0,100)}` : ''}. Local pickup and shipping not verified. Before tax and shipping. ${String(record.promotion_fulltext || '').slice(0,400)}`.trim() }
}

// Only called inside a background worker. No retries of POST, no redirects, no
// arbitrary provider URLs, and bounded response size/time. A saved snapshot can
// be polled again after a timeout without launching another paid job.
export async function checkHomeDepot(db: SupabaseClient, item: WishItem, url: string): Promise<SearchResult> {
  if (!homeDepotEnabled()) throw new HomeDepotCheckError('Home Depot background checks are disabled.')
  const zipcode = process.env.HOME_DEPOT_ZIPCODE!
  const configured = Number(process.env.BRIGHTDATA_MONTHLY_LIMIT || 3000)
  const limit = Number.isInteger(configured) && configured > 0 ? Math.min(configured,4000) : 0
  const { data: reservation, error } = await db.rpc('reserve_home_depot_check', { product: homeDepotId(url), zip: zipcode, monthly_limit: limit })
  if (error) throw new HomeDepotCheckError('Home Depot usage protection is unavailable. Apply home-depot-checks.sql before enabling checks.')
  if (!reservation) throw new HomeDepotCheckError('Home Depot monthly check allowance reached. Previous prices were kept.')
  const job = reservation.job
  const signal = AbortSignal.timeout(300000)
  async function request(path: string, body?: unknown) {
    const response = await fetch(api + path, { method: body ? 'POST' : 'GET', redirect:'error',
      headers: { Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`, 'Content-Type':'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal,AbortSignal.timeout(20000)]) })
    if (!response.ok) throw new HomeDepotCheckError('Home Depot provider is unavailable or its free allowance is exhausted. Previous prices were kept.')
    const reader=response.body?.getReader(); if(!reader) throw new HomeDepotCheckError('Empty Home Depot response')
    const chunks:Uint8Array[]=[];let size=0
    try { for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new HomeDepotCheckError('Home Depot response was too large');chunks.push(value)} }
    finally {await reader.cancel().catch(()=>{})}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  if (!job.result) {
    if (reservation.start) {
      const triggered = await request(`trigger?dataset_id=${dataset}`, { input:[{url,zipcode,all_variations:false}], limit_per_input:1 })
      if (!/^sd_[a-zA-Z0-9]+$/.test(triggered.snapshot_id || '')) throw new HomeDepotCheckError('Home Depot did not accept the check.')
      const saved = await db.from('home_depot_checks').update({snapshot_id:triggered.snapshot_id}).eq('id',job.id)
      if (saved.error) throw new HomeDepotCheckError('Could not save the Home Depot check. No new lookup will be started today.')
      job.snapshot_id=triggered.snapshot_id
    }
    if (!/^sd_[a-zA-Z0-9]+$/.test(job.snapshot_id || '')) throw new HomeDepotCheckError('A Home Depot lookup is already starting or could not be confirmed. Retry later; no duplicate lookup was started.')
    for (;;) {
      const progress=await request(`progress/${job.snapshot_id}`)
      if(progress.status==='ready')break
      if(!['running','starting'].includes(progress.status))throw new HomeDepotCheckError('Home Depot could not finish this check. Previous prices were kept.')
      await new Promise<void>((resolve,reject)=>{
        const aborted=()=>{clearTimeout(timer);reject(new HomeDepotCheckError('Home Depot check timed out. Retry to resume the saved lookup.'))}
        const timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve()},5000)
        signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted()
      })
    }
    const records=await request(`snapshot/${job.snapshot_id}?format=json`)
    if(!Array.isArray(records)||records.length!==1)throw new HomeDepotCheckError('Home Depot did not return one exact product.')
    // Validate before caching. Never turn an error record into verified history.
    homeDepotOffer(records[0],url,item,zipcode)
    // Keep only pricing/identity evidence, not public reviews or unrelated data.
    job.result=Object.fromEntries(['product_id','url','product_name','manufacturer','variation','final_price','initial_price','currency','zipcode','in_stock','add_to_cart','discontinued','promotion_fulltext','store_name','seller_url'].filter(key=>records[0][key]!==undefined).map(key=>[key,records[0][key]]))
    job.checked_at=new Date().toISOString()
    const saved=await db.from('home_depot_checks').update({result:job.result,checked_at:job.checked_at}).eq('id',job.id)
    if(saved.error)throw new HomeDepotCheckError('Could not save the Home Depot observation.')
  }
  const offer=homeDepotOffer(job.result,url,item,zipcode)
  return {products:[{...item,offers:[offer]}],sources:[{title:job.result.product_name,url}],checked_at:job.checked_at,
    summary:'Home Depot product price checked.',warnings:[],retailer_checks:[]}
}
