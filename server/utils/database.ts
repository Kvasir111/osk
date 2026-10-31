import { createClient } from '@supabase/supabase-js'
import { createError, getHeader, type H3Event } from 'h3'

export function databaseConfig() {
  const url = process.env.NUXT_PUBLIC_SUPABASE_URL
  const key = process.env.NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw createError({ statusCode: 503, statusMessage: 'Supabase is not configured yet.' })
  return { url, key }
}

export function adminDatabase() {
  const { url } = databaseConfig()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw createError({ statusCode: 503, statusMessage: 'Server database access is not configured yet.' })
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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

export function dbResult<T>({ data, error }: { data: T; error: unknown }) {
  if (error) throw createError({ statusCode: 400, statusMessage: 'The change could not be saved. Check your access and database setup.' })
  return data
}
