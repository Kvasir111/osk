import { AVATAR_MAX_BYTES, profileSchema, type Profile } from '../../shared/profile'

export function useProfile() {
  const { api, demo, user } = useAccount()
  const profile = useState<Profile | null>('account-profile', () => null)
  const loadedAt = useState('profile-loaded-at', () => 0)
  const displayName = computed(() => profile.value?.display_name || user.value?.email?.split('@')[0] || 'Your space')
  const avatarUrl = computed(() => profile.value?.avatar_url || null)

  async function loadProfile(force = false) {
    if (!force && profile.value && Date.now() - loadedAt.value < 45 * 60000) return
    if (demo) {
      try {
        const saved = JSON.parse(localStorage.getItem('osk-demo-profile-v1') || 'null')
        profile.value = saved && typeof saved.display_name === 'string' ? saved : { display_name: '', avatar_url: null, email: '' }
      } catch { profile.value = { display_name: '', avatar_url: null, email: '' } }
    } else profile.value = await api<Profile>('/api/profile')
    loadedAt.value = Date.now()
  }
  function persistDemo(next: Profile) {
    localStorage.setItem('osk-demo-profile-v1', JSON.stringify(next))
    profile.value = next
  }
  async function saveName(name: string) {
    const input = profileSchema.parse({ display_name: name })
    if (demo) persistDemo({ ...profile.value!, ...input })
    else profile.value = await api<Profile>('/api/profile', { method: 'PATCH', body: input })
  }
  async function uploadAvatar(file: File) {
    if (file.size > AVATAR_MAX_BYTES) throw new Error('Choose a picture smaller than 3 MB.')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP picture.')
    if (demo) {
      const bitmap = await createImageBitmap(file)
      try {
        if (bitmap.width * bitmap.height > 20_000_000) throw new Error('Choose a picture up to 20 megapixels.')
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 512
        const context = canvas.getContext('2d')!
        const side = Math.min(bitmap.width, bitmap.height)
        context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512)
        persistDemo({ ...profile.value!, avatar_url: canvas.toDataURL('image/webp', 0.82) })
      } finally { bitmap.close() }
    } else {
      const body = new FormData()
      body.append('avatar', file)
      profile.value = await api<Profile>('/api/profile/avatar', { method: 'POST', body })
    }
  }
  async function removeAvatar() {
    if (demo) persistDemo({ ...profile.value!, avatar_url: null })
    else profile.value = await api<Profile>('/api/profile/avatar', { method: 'DELETE' })
  }
  return { profile, displayName, avatarUrl, loadProfile, saveName, uploadAvatar, removeAvatar }
}
