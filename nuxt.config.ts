import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-30',
  ssr: false,
  nitro: { prerender: { routes: ['/'] } },
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  runtimeConfig: { public: { supabaseUrl: '', supabasePublishableKey: '' } },
  app: { head: {
    title: 'Ósk · Wishes, kept simply',
    htmlAttrs: { lang: 'en' },
    script: [{ src: '/theme-init.js', tagPosition: 'head', tagPriority: 'critical' }],
    meta: [{ name: 'theme-color', content: '#283f47' }, { name: 'apple-mobile-web-app-capable', content: 'yes' }, { name: 'apple-mobile-web-app-title', content: 'Ósk' }, { name: 'description', content: 'Make wishlists, share with your people, and keep an eye on prices.' }],
    link: [{ rel: 'manifest', href: '/manifest.webmanifest' }, { rel: 'apple-touch-icon', href: '/icons/osk-180.png' }, { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  } },
  routeRules: { '/api/**': { headers: { 'Cache-Control': 'private, no-store' } } },
})
