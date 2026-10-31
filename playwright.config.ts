import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:3210', headless: true },
  webServer: { command: 'pnpm run dev --host 127.0.0.1 --port 3210', url: 'http://127.0.0.1:3210', reuseExistingServer: !process.env.CI, timeout: 60000,
    env: { NUXT_PUBLIC_SUPABASE_URL: '', NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', OPENAI_API_KEY: '' } },
  reporter: 'list',
})
