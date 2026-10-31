import type { SupabaseClient } from '@supabase/supabase-js'
import type { WishItem } from '../../shared/types'
import { dbResult } from './database'
export async function itemHistory(db: SupabaseClient, item: Pick<WishItem, 'id' | 'name' | 'variant'>) {
  return dbResult(await db.from('price_observations').select('*').eq('item_id', item.id)
    .eq('name', item.name).eq('variant', item.variant)
    .gte('observed_at', new Date(Date.now() - 365 * 86400000).toISOString())
    .order('observed_at', { ascending: false }).limit(2000))
}
