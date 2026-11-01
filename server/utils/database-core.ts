import { createClient } from '@supabase/supabase-js'

// Shared by Nitro and standalone workers. Keep HTTP framework imports out of this module.
function databaseError(statusCode: number, statusMessage: string) {
  return Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

export function adminDatabase() {
  const url = process.env.NUXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw databaseError(503, 'Server database access is not configured yet.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function dbResult<T>({ data, error }: { data: T; error: unknown }) {
  if (error) throw databaseError(400, 'The change could not be saved. Check your access and database setup.')
  return data
}
