import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceTrackingData } from '../../shared/types'
import { dbResult } from './database'
export async function priceTracking(db:SupabaseClient,userId:string):Promise<PriceTrackingData> {
  const [watches,alerts,count]=await Promise.all([
    db.from('price_watches').select('*').eq('user_id',userId).order('created_at',{ascending:false}),
    db.from('price_alerts').select('*').eq('user_id',userId).order('observed_at',{ascending:false}).limit(100),
    db.from('price_alerts').select('id',{count:'exact',head:true}).eq('user_id',userId).is('read_at',null),
  ])
  return {watches:dbResult(watches)||[],alerts:dbResult(alerts)||[],unread_count:dbResult({data:count.count||0,error:count.error})}
}
