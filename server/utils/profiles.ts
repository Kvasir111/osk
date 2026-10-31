import { createError } from 'h3'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { AVATAR_MAX_BYTES, AVATAR_BUCKET, ownedAvatarPath, profileName, type Profile } from '../../shared/profile'

export async function profileForUser(admin: SupabaseClient, user: User): Promise<Profile> {
  const path = ownedAvatarPath(user.id, user.user_metadata.osk_avatar_path)
  let avatar_url: string | null = null
  if (path) {
    const { data } = await admin.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600)
    avatar_url = data?.signedUrl || null
  }
  return { display_name: profileName(user.user_metadata), avatar_url, email: user.email || '' }
}

export async function prepareAvatar(input: Buffer) {
  if (!input.length || input.length > AVATAR_MAX_BYTES)
    throw createError({ statusCode: 400, statusMessage: 'Choose a picture smaller than 3 MB.' })
  try {
    const { default: sharp } = await import('sharp')
    const image = sharp(input, { limitInputPixels: 20_000_000, animated: false })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1) throw new Error('Unsupported image')
    // Re-encoding strips EXIF/location data and prevents serving arbitrary uploads.
    return await image.rotate().resize(512, 512, { fit: 'cover', position: 'centre', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Choose a valid JPG, PNG, or WebP picture up to 20 megapixels.' })
  }
}
