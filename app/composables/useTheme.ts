export type ColorTheme = 'light' | 'dark'

export function useTheme() {
  const theme = useState<ColorTheme>('color-theme', () =>
    import.meta.client && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const preference = useState<ColorTheme | null>('theme-preference', () => null)

  function applyTheme(value: ColorTheme) {
    theme.value = value
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value
  }
  function toggleTheme() {
    const value = theme.value === 'dark' ? 'light' : 'dark'
    preference.value = value
    applyTheme(value)
    try { localStorage.setItem('osk-theme', value) } catch { /* In-memory preference still works. */ }
  }
  return { theme, preference, applyTheme, toggleTheme }
}
