import type { SupabaseClient } from '@supabase/supabase-js'
import { createError } from 'h3'
import type { ProductDraft, WishList } from '../../shared/types'
import { writeItem } from './item-write'
import { dbResult } from './database'

// Client UUIDs are the idempotency keys. Reads and writes always use the caller's
// authenticated client, so a retry cannot bypass RLS or change a previously saved row.
export async function createOfflineItem(db: SupabaseClient, id: string, listId: string, product: ProductDraft) {
  const result = await writeItem(db, { ...product, id, list_id: listId, checked_at: null, last_attempt_at: null, refresh_status: 'never' })
  if (result.error?.code === '23505') {
    const existing = dbResult(await db.from('wish_items').select('*').eq('id', id).eq('list_id', listId).maybeSingle())
    if (existing) return existing
    throw createError({ statusCode: 409, statusMessage: 'This addition could not be matched. Please retry with a new wish.' })
  }
  return dbResult(result)
}
export async function createOfflineList(db: SupabaseClient, id: string, ownerId: string, input: Pick<WishList, 'name' | 'description' | 'occasion'>) {
  const result = await db.from('wish_lists').insert({ ...input, id, owner_id: ownerId }).select().single()
  if (result.error?.code === '23505') {
    const existing = dbResult(await db.from('wish_lists').select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle())
    if (existing) return existing
    throw createError({ statusCode: 409, statusMessage: 'This list could not be matched. Please retry with a new list.' })
  }
  return dbResult(result)
}
