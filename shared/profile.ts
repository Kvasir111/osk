import { z } from 'zod'

export interface Profile {
  display_name: string
  avatar_url: string | null
  email: string
}
export const profileSchema = z.object({ display_name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use 100 characters or fewer.') })
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024
export const AVATAR_BUCKET = 'profile-pictures'

export function avatarInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? [...words[0]!][0]! + [...words[words.length - 1]!][0]! : [...(words[0] || 'ME')].slice(0, 2).join('')).toLocaleUpperCase()
}

export function profileName(metadata: Record<string, unknown>) {
  const value = metadata.display_name
  return typeof value === 'string' ? value.trim().slice(0, 100) : ''
}

export function ownedAvatarPath(userId: string, value: unknown): string | null {
  return typeof value === 'string' && value.startsWith(`${userId}/`) &&
    /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/.test(value) ? value : null
}
