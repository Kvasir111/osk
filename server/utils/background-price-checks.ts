import type { SupabaseClient } from '@supabase/supabase-js'
import type { WishItem } from '../../shared/types'
import { homeDepotEnabled, homeDepotLink } from './home-depot'
import { refreshItem } from './refresh-prices'

export async function dispatchPriceCheck(db: SupabaseClient, id: string, actorId: string) {
  const cutoff=new Date(Date.now()-10*60000).toISOString()
  if (process.env.URL) {
    if(!process.env.PRICE_REFRESH_SECRET)throw new Error('Background authentication is not configured')
    const response=await fetch(new URL('/.netlify/functions/refresh-prices-background',process.env.DEPLOY_URL || process.env.URL),{
      method:'POST',headers:{Authorization:`Bearer ${process.env.PRICE_REFRESH_SECRET}`,'Content-Type':'application/json'},
      body:JSON.stringify({ids:[id],cutoff,actor_id:actorId}),signal:AbortSignal.timeout(5000),redirect:'error',
    })
    if(response.status!==202)throw new Error('Background price check was not accepted')
    return
  }
  if(process.env.NETLIFY || process.env.NODE_ENV==='production')throw new Error('Background URL is not configured')
  // Dev server is persistent; Netlify uses the durable background invocation.
  void refreshItem(db,id,cutoff,actorId).catch(()=>console.warn('Local price check unavailable',{id}))
}
export async function queueHomeDepotCheck(db: SupabaseClient, item: WishItem, actorId: string) {
  if(!homeDepotEnabled() || item.status && item.status!=='active' || !homeDepotLink(item))return
  try {await dispatchPriceCheck(db,item.id,actorId)}
  catch {console.warn('Home Depot dispatch unavailable; daily worker will retry',{id:item.id})}
}
