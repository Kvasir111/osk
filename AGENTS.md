# Working on Ósk

Ósk is a friends-and-family wishlist app built with Nuxt 4, Vue, Tailwind 4, Supabase, and OpenAI, deployed to Netlify. Read `README.md` for setup and feature details. Preserve the Nordic visual style, accented app name, and light/dark themes.

## Development

- Use Node 24 (`.nvmrc`) and pnpm, pinned in `package.json`. Keep `pnpm-lock.yaml`; do not introduce another package manager's lockfile.
- Install with `pnpm install --frozen-lockfile`; start with `pnpm run dev`.
- Preserve existing `.env` values. Copy `.env.example` only when `.env` does not exist. Never print, commit, or include credentials or auth callback tokens in logs or screenshots.
- Keep changes focused and follow existing components, validation, and utility patterns.
- Avoid simultaneous builds, type generation, and dev servers sharing generated directories. Use an isolated checkout for production/PWA verification when needed, and stop only processes you started.

## Code map

- `app/pages`, `app/components`: routes and UI; `app/assets/css`: shared styling and theme tokens.
- `app/composables`: session, profiles, wishlist state, and research progress.
- `app/utils/offline-storage.ts`: account-scoped IndexedDB snapshots and outbox.
- `shared`: types, validation, pricing, retailer matching, and other shared logic.
- `server/api/[...path].ts`: API routing; `server/utils`: authorization, database access, research, images, history, and sync.
- `netlify/functions`: scheduled and background workers.
- `supabase`: schema and additive feature SQL; `tests/database/access.test.ts`: database permission tests.
- `scripts/build-pwa.mjs`: generated service worker and public asset handling.

## Product behavior

- Keep the unconfigured local demo usable. Its prices are fictional and its data stays local; connecting a backend must not upload demo data.
- Store USD amounts as integer cents. Manufacturer MSRP is the baseline; unknown MSRP stays unknown. A retailer's crossed-out price is not manufacturer MSRP.
- Match exact products and variants. Preserve listing URLs and source evidence, seller identity, shipping qualifications, and discount conditions. Aim for two independent non-manufacturer retailers without inventing offers or substituting variants.
- Research produces a draft requiring explicit approval before item creation. Background completion must recheck permissions and preserve subsequent manual edits, custom pictures, and newer prices.
- Price history records actual observations. Failed checks retain previous offers; manual offers do not become verified sale history. Image-only changes must not create price observations.
- Preserve category artwork as the fallback for missing or failed product photos. Use the existing hardened metadata/image fetcher with public-address checks and bounded redirects, response sizes, and timeouts.
- Photo Quick Add is currently a stub: the selected photo is a temporary local reference, not uploaded, persisted, or recognized. Users enter details and choose lists.
- Secret Santa lives in family hubs: members opt in, only organizers configure/draw, exclusions apply both ways, and draws lock. Assignment reads must expose only the caller’s recipient, including for organizers; events grant no new wishlist access.
- The PWA share target routes URL/text/title to `/capture` for review. Receiving a share must never start research or save automatically. Preserve the login return path, offline manual capture, and copy-link fallback for unsupported browsers.
- Reuse theme tokens and accessible controls. Check actual mobile viewports, both themes, keyboard navigation, and readable contrast. Keep the document language and static `robots.txt` valid.

## Authentication and data access

- The app is client-rendered (`ssr: false`); Supabase's browser SDK manages sessions. Preserve this architecture unless deliberately changing it.
- Only Supabase URL and publishable key belong in public runtime config. Service-role keys, OpenAI keys, worker secrets, and invitation admin settings remain server-only.
- Verify API callers through the existing `requireUser` / `auth.getUser(token)` flow. Authorize using verified account IDs, never editable profile metadata.
- Use caller-scoped database access for ordinary CRUD. Limit service-role access to explicitly authorized privileged operations and worker internals.
- Owners manage list settings and sharing; editors manage items; viewers read. Family membership grants view access only to shared lists. Public share tokens are read-only and revocable; do not expose anonymous table access.
- Profile pictures stay in the private bucket with authorized signed URLs and validated, re-encoded uploads. Do not make the bucket public to resolve display issues.
- Public signup is disabled. Account invitations use server-side admin APIs and the verified-email allowlist; accepting an account invitation does not automatically grant list or family access.
- Production magic-link callbacks must use the deployed origin and permitted `/login` redirects, including invitation return paths. Do not hardcode localhost into production callbacks.

## Database changes

- Use the available Supabase and Postgres skills when working on database schema, policies, or queries.
- Preserve RLS, least-privilege grants, and the non-exposed `private` helper schema with empty function search paths. Add meaningful permission coverage when changing access rules.
- Fresh-project setup order is `schema.sql`, `features.sql`, `search-jobs.sql`, `item-pictures.sql`, then `account-invitations.sql`, each once. Do not rerun bootstrap SQL against an existing project.
- Put subsequent changes in reviewed additive SQL. Editing a SQL file does not apply it to the live project, and a service-role API key cannot apply DDL. Report schema application separately from local validation.
- `supabase/secret-santa.sql` is the additive event upgrade after the initial setup. Keep event writes transactional through the service-only RPC, with verified caller IDs and current membership checks; browser roles receive scoped reads only.

## Offline and PWA behavior

- Keep cached data and queued additions scoped to the authenticated account. Do not copy auth tokens into IndexedDB or show/sync one account's drafts under another account.
- Persist additions before network submission. Sync new lists before their items and preserve stable client UUIDs for idempotent retries.
- Server retries must read existing records through scoped access and must not overwrite later edits. Recheck current permissions on sync.
- Preserve drafts and failure reasons after network errors or expired sessions. Reauthentication keeps the queue; explicit signout warns about pending changes and clears that account's local data.
- Guard asynchronous responses against account changes and stale state. Preserve the existing restrictions on offline edits, research, invitations, and sharing.
- Sync resumes while the app is open or on reconnect/next online launch; do not promise closed-app background sync on mobile.
- Cache only the public app shell and known static assets in the service worker, never authenticated/API/third-party responses. Keep file-like routes out of SPA navigation fallback.
- Worker updates must not unexpectedly reload open forms. Keep account data in IndexedDB separate from versioned shell caches.

## Verification

Run checks appropriate to the change; documentation-only changes do not require the full suite.

| Command | Purpose |
| --- | --- |
| `pnpm run typecheck` | Nuxt/Vue/TypeScript checks |
| `pnpm test` | Unit and PGlite database permission tests |
| `pnpm run test:e2e` | Browser flows with demo/mocked APIs |
| `pnpm run build` | Production build including service worker generation |
| `pnpm run test:pwa` | Production-worker offline and sync tests |
| `NITRO_PRESET=netlify pnpm run build` | Netlify adapter build |

- Install Chromium with `pnpm exec playwright install chromium` if needed.
- PWA tests require a fresh default/Node build using test-only public Supabase settings; see `playwright.pwa.config.ts` and `tests/pwa/preview.mjs`. Do not substitute live credentials into mocked QA flows.
- Preserve the complete build script; running only `nuxt build` skips PWA generation.
- Use mocked providers for routine tests. Do not send real invitation emails, mutate real user data, or consume paid research calls just for smoke tests.

## Deployment

- `netlify.toml` controls the Node version, adapter, functions, headers, and daily schedule. Preserve worker authentication, atomic leases, and usage budgets.
- Keep secret scanning enabled. The existing narrow `OPENAI_MODEL` exclusion handles a public model-name false positive; never exempt real credentials.
- Update `README.md` and `.env.example` when configuration or setup changes, using placeholders for secrets.
- Distinguish local checks, live database changes, and deployed behavior in completion reports. A successful build alone does not verify deployment.
