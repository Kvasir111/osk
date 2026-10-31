import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-30',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  runtimeConfig: { public: { supabaseUrl: '', supabasePublishableKey: '' } },
  app: { head: {
    title: 'Ósk · Wishes, kept simply',
    script: [{ src: '/theme-init.js', tagPosition: 'head', tagPriority: 'critical' }],
    meta: [{ name: 'description', content: 'Make wishlists, share with your people, and keep an eye on prices.' }],
    link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  } },
  routeRules: { '/api/**': { headers: { 'Cache-Control': 'private, no-store' } } },
})
