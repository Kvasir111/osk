import type { ColorTheme } from '~/composables/useTheme'

export default defineNuxtPlugin(nuxtApp => {
  const { theme, preference, applyTheme } = useTheme()
  const device = window.matchMedia('(prefers-color-scheme: dark)')
  const parse = (value: string | null): ColorTheme | null => value === 'dark' || value === 'light' ? value : null
  try { preference.value = parse(localStorage.getItem('osk-theme')) } catch { /* Use device preference. */ }
  const sync = () => applyTheme(preference.value || (device.matches ? 'dark' : 'light'))
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'osk-theme' || event.key === null) {
      preference.value = parse(event.newValue)
      sync()
    }
  }
  sync()
  device.addEventListener('change', sync)
  window.addEventListener('storage', onStorage)
  useHead({ meta: [{ name: 'theme-color', content: () => theme.value === 'dark' ? '#141e23' : '#f7f8f8' }] })
  nuxtApp.vueApp.onUnmount(() => {
    device.removeEventListener('change', sync)
    window.removeEventListener('storage', onStorage)
  })
})
