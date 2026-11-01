import { createClient } from '@supabase/supabase-js'
import { createError, getHeader, type H3Event } from 'h3'
export { adminDatabase, dbResult } from './database-core'

export function databaseConfig() {
  const url = process.env.NUXT_PUBLIC_SUPABASE_URL
  const key = process.env.NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw createError({ statusCode: 503, statusMessage: 'Supabase is not configured yet.' })
  return { url, key }
}

export async function requireUser(event: H3Event) {
  const { url, key } = databaseConfig()
  const token = getHeader(event, 'authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Please sign in.' })
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user || data.user.is_anonymous) throw createError({ statusCode: 401, statusMessage: 'Please sign in again.' })
  return { db, user: data.user }
}
