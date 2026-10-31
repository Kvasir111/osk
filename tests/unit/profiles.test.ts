import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { AVATAR_MAX_BYTES, avatarInitials, ownedAvatarPath, profileSchema } from '../../shared/profile'
import { prepareAvatar } from '../../server/utils/profiles'

describe('Profile data and image boundaries', () => {
  it('accepts Unicode names and strips fields unrelated to profile presentation', () => {
    expect(profileSchema.parse({ display_name: '  Ólafur Jónsson  ', id: 'another-user', app_metadata: { admin: true } }))
      .toEqual({ display_name: 'Ólafur Jónsson' })
    expect(profileSchema.safeParse({ display_name: '  ' }).success).toBe(false)
    expect(profileSchema.safeParse({ display_name: 'a'.repeat(101) }).success).toBe(false)
    expect(avatarInitials('Ólafur Jónsson')).toBe('ÓJ')
  })
  it('will only sign or remove a picture in the verified user’s own folder', () => {
    const owner = '10000000-0000-0000-0000-000000000001'
    const other = '10000000-0000-0000-0000-000000000002'
    const path = `${owner}/20000000-0000-0000-0000-000000000001.webp`
    expect(ownedAvatarPath(owner, path)).toBe(path)
    expect(ownedAvatarPath(other, path)).toBeNull()
    expect(ownedAvatarPath(owner, `${owner}/../${other}/image.webp`)).toBeNull()
    expect(ownedAvatarPath(owner, 'https://example.com/avatar.webp')).toBeNull()
  })
  it('decodes, square-crops, resizes, and strips metadata from an actual raster image', async () => {
    const source = await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#637e84' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    expect((await sharp(source).metadata()).exif).toBeDefined()
    const result = await sharp(await prepareAvatar(source)).metadata()
    expect(result.format).toBe('webp')
    expect([result.width, result.height]).toEqual([512, 512])
    expect(result.exif).toBeUndefined()
    expect(result.orientation).toBeUndefined()
  })
  it('rejects oversized, corrupted, and non-raster uploads', async () => {
    await expect(prepareAvatar(Buffer.alloc(AVATAR_MAX_BYTES + 1))).rejects.toMatchObject({ statusCode: 400 })
    await expect(prepareAvatar(Buffer.from('not an image'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(prepareAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" /></svg>'))).rejects.toMatchObject({ statusCode: 400 })
  })
})
