import { createClient } from '@supabase/supabase-js'
import { AVATAR_BUCKET, AVATAR_MAX_BYTES } from '../shared/profile.ts'

const url = process.env.NUXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Configure the server Supabase URL and key first.')
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: buckets, error: listError } = await admin.storage.listBuckets()
if (listError) throw new Error('Could not inspect profile storage.')
const existing = buckets.find(bucket => bucket.id === AVATAR_BUCKET)
if (existing?.public) throw new Error('The profile-pictures bucket must be private. Inspect it before changing its access.')
if (!existing) {
  const { error } = await admin.storage.createBucket(AVATAR_BUCKET, {
    public: false, fileSizeLimit: AVATAR_MAX_BYTES, allowedMimeTypes: ['image/webp'],
  })
  if (error) throw new Error('Could not create private profile storage.')
}
const { data, error } = await admin.storage.getBucket(AVATAR_BUCKET)
if (error || !data || data.public) throw new Error('Private profile storage verification failed.')
console.log('Profile picture storage is ready (private, server-managed).')
