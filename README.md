# Ósk

A friends-and-family wishlist built with Nuxt 4, Vue, Tailwind 4, Supabase, and OpenAI. Deploys to Netlify.

Save products from any store, organize occasion lists, compare offers with manufacturer MSRP, and share lists with your people. The assistant searches for exact models and variants, shows sources, and requires approval before saving. Daily checks run on Netlify.

The Dark mode toggle is available on every page. The initial theme follows the device and updates with it until a light/dark choice is saved in this browser. A saved choice also applies to shared lists, sign-in, and dialogs, and is applied before the page paints.

## Profiles

Open **Edit profile** from your name/avatar in the wishlist sidebar to set your name and upload, replace, or remove your profile picture. The account link and list-owner collaborator view use these details. The name is display metadata; authorization continues to use verified user IDs, never profile fields.

On a fresh deployment, run `pnpm run setup:profiles` once with your server Supabase settings to create the private `profile-pictures` storage bucket. No database migration is needed. Raw Storage uploads and reads remain unavailable to clients; authenticated server endpoints scope profile changes to the verified account. Pictures are served to authorized profile/collaborator views with one-hour signed URLs. Do not make the bucket public or add permissive client Storage policies.

Uploads accept JPG, PNG, and WebP up to 3 MB and 20 megapixels. The server decodes and re-encodes them as square WebP thumbnails up to 512 pixels, removing embedded metadata. Replacements and removals clean up old files. The local demo stores its editable name and resized picture only in browser storage.

## Run locally

Use Node 24 (see `.nvmrc`) and pnpm 10.33.0 (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
cp .env.example .env # only if .env does not already exist
pnpm run dev
```

Without Supabase configuration, the app runs an explicitly labeled local demo. Sample prices are fictional examples, not current offers. Lists and edits persist in browser local storage; sharing, AI search, and daily checks are disabled. Demo data is never uploaded when a backend is connected.

## Connect the new Supabase project

1. Use a **dedicated project**, separate from the drinks app.
2. Run [`supabase/schema.sql`](supabase/schema.sql), then [`supabase/features.sql`](supabase/features.sql), then [`supabase/search-jobs.sql`](supabase/search-jobs.sql) and [`supabase/item-pictures.sql`](supabase/item-pictures.sql), each **once**, in its SQL Editor. Together they create the tables, RLS policies, grants, and service-only budget/lease functions. It is not a migration that has already been applied. Keep future changes in reviewed migrations; do not rerun the bootstrap on existing tables.
3. In the project's Connect/API settings, get the project URL and publishable key. Put them in `.env` as `NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Add the **server-only** service-role key as `SUPABASE_SERVICE_ROLE_KEY`. It supports token-based shared views, account invitations, and daily workers. It never goes into public runtime config.
5. Configure Supabase Auth:
   - Set Site URL to the deployed origin; add the appropriate local and deployed `/login` redirect URLs, including the `/login?next=...` path needed for collaboration invitations. For local development, allow `http://localhost:3000/**` and the loopback URL if used. Use the deployed origin's `/**` pattern for query-bearing callbacks.
   - Disable public signups and anonymous sign-ins. Invite your own account and family accounts through **Authentication → Users**. The app's sign-in uses `shouldCreateUser: false`.
   - Configure custom SMTP before inviting family members. Supabase's default sender only delivers to organization team addresses and is intended for testing, not family email delivery. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

Restart the dev server after changing public environment values. The app verifies bearer tokens with `auth.getUser()` on every authenticated API request. Since this is a client-rendered Nuxt app (`ssr: false`), browser sessions use the standard Supabase client; there are no server-rendered session cookies to manage.

### Access and sharing

- Owners manage list settings, sharing links, and membership.
- Editors can add, edit, remove, and refresh items. Viewers can read only.
- View-only links require no account. Anyone possessing the link can read that list; links can be disabled or rotated. Raw database access remains unavailable to anonymous visitors.
- Collaboration links require an existing approved account, expire in 7 days, and may be used by multiple recipients. Treat editor invitations as edit access. Owners can revoke outstanding invitations and separately remove existing members.
- Private helper functions use `auth.uid()`, an empty search path, and explicit grants to avoid recursive RLS. They live in the non-exposed `private` schema. Do not add `private` to the Data API's exposed schemas.

## Connect OpenAI

Set `OPENAI_API_KEY` in `.env` locally and in Netlify's environment variables for deployment. Keys stay server-side. The default `OPENAI_MODEL` is `gpt-5.5`; it is configurable and must support Responses, web search, reasoning, and structured outputs.

Interactive research uses durable, private Supabase jobs and the protected Netlify `product-search-background` function. The initial API request returns a job ID immediately. A focused lookup identifies the product first (pasted URLs constrain that lookup to their host). It publishes an approvable result, then two independent comparison stages run in parallel. Amazon URLs skip redundant Amazon discovery and check manufacturer MSRP instead. Each stage returns structured findings directly, so there is no separate consolidation model call. The browser polls for new results and shows per-stage progress; the app-level activity notification lets a user leave the dialog, navigate, reload, and resume research.

Approval attaches one saved item to the job. Remaining offers and diagnostics are applied when research finishes, including if the dialog has closed. The worker checks that the approving user still owns/edits the list and uses optimistic field guards to preserve later item edits or newer prices. Repeated dispatches claim a job only once. Research never creates an item without approval. Failed comparison stages retain existing evidence and show incomplete coverage. Stalled jobs become retryable failures when polled after three minutes without progress.

`OPENAI_SEARCH_MODEL` optionally overrides the interactive model; by default it falls back to your existing `OPENAI_MODEL` (`gpt-5.5`). `OPENAI_EXTRACTION_MODEL` separately controls structured formatting for legacy/daily synchronous checks, also falling back to `OPENAI_MODEL`. Both GPT-5.5 and GPT-5.4 mini were tried on two product URLs and their retailer comparisons. Mini was faster in that small exploratory sample but proposed a wrong supplement formulation and weak listing evidence. The configured default was kept. This is not a controlled quality/latency benchmark or a guarantee about other products. Model/stage/duration/status diagnostics contain no queries, list contents, or credentials.

The new pipeline filters known category/search URLs, mismatched listing titles/model numbers, and marketplace offers without identified sellers. Daily refreshes and the legacy synchronous search endpoints retain the original three parallel research calls plus a structured extraction call. Two independent retailer prices remain a target, never a reason to fabricate offers or substitute another variant.
Offers are retained only when their URLs occur in actual search sources/citations. Tracking parameters are ignored for evidence matching, while product-variant and seller selectors are preserved. One invalid offer does not discard the other valid offers. Missing MSRP stays unknown; a crossed-out retailer price is not an MSRP baseline. Ambiguous models appear as separate candidates for approval. No purchase or automatic list addition occurs.

Interactive jobs use up to three model requests plus web search; legacy/daily checks use up to four. Interactive searches and manual refreshes share a limit of 20 per user per UTC day. Automatic checks run separately, approximately once per saved item per day. Set an appropriate project budget/usage alerts in your OpenAI account. Failed interactive searches can still consume provider usage and a rate-limit slot.

Search is evidence-based discovery, not a retailer inventory feed. Prices, stock, seller quality, shipping, and discounts can be unavailable or stale. The interface labels unverified shipping/stock, links to sources, and asks shoppers to confirm checkout details. Current prices are USD, before tax and shipping. Coupons and membership conditions are shown as offer notes when available. Coverage, hidden accommodation pricing, and alerts are not guaranteed. Price history records observations made by Ósk rather than reconstructing historical retailer data.

## Deploy to Netlify

Connect this repository to your Netlify site. `netlify.toml` sets:

- Build: `pnpm run build`
- Publish: `dist`
- Node: 24
- Nitro adapter: `netlify`
- Custom functions: `netlify/functions`

Add these environment variables in Netlify, available at build time **and to Functions**:

| Variable | Purpose |
| --- | --- |
| `NUXT_PUBLIC_SUPABASE_URL` | New project's URL; public |
| `NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key; public |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access |
| `OPENAI_API_KEY` | Server-only OpenAI key |
| `OPENAI_MODEL` | Optional; defaults to `gpt-5.5` |
| `OPENAI_SEARCH_MODEL` | Optional override for interactive background research |
| `OPENAI_EXTRACTION_MODEL` | Optional formatter for legacy/daily synchronous checks |
| `PRICE_REFRESH_SECRET` | Random server-only worker secret |

Generate the worker secret with `openssl rand -hex 32`. Netlify supplies `URL` automatically for dispatch to the same site's workers. Interactive jobs require `product-search-background` and the existing `PRICE_REFRESH_SECRET`; production does not use an in-memory fallback. Local Nuxt development runs jobs in its persistent dev process. A running local job can be interrupted by a server restart; its saved findings remain recoverable and stalled jobs can be retried. Rebuild after public config changes. Do not publish `.env`, secret keys, or a database password.

### Daily refresh

`daily-prices` runs at **12:00 UTC every day** (7 a.m. Chicago during daylight saving time; 6 a.m. standard time). It finds items not attempted since UTC midnight and dispatches batches of ten to `refresh-prices-background`. Each worker validates a secret and atomically leases items through a service-only RPC, preventing duplicate checks by overlapping workers. Each item search has a 48-second deadline; batches stay below the background function's 15-minute limit. [Netlify scheduling](https://docs.netlify.com/build/functions/scheduled-functions/), [background functions](https://docs.netlify.com/build/functions/background-functions/).

Successful exact-variant checks replace offers and the checked timestamp, preserving the original MSRP once established. Failed or unmatched checks keep the previous prices and set a visible failure state. Failures are attempted again the next day; manual checks are also available, with a five-minute cooldown. Editing an item marks its offers as manually entered and makes it eligible for the next daily check.

Scheduled execution works only on published production deploys. After deployment, confirm the `daily-prices` scheduled badge and next run in Netlify Functions. Use **Run now** to verify a real refresh without waiting. Background Functions must be supported by your Netlify plan. The dispatcher is intended for family-sized lists; a much larger catalog would need a durable queue and bounded dispatch concurrency.

## Checks

```sh
pnpm run typecheck
pnpm test
pnpm exec playwright install chromium
pnpm run test:e2e
NITRO_PRESET=netlify pnpm run build
```

The tests cover pricing/source validation, refresh failures/variant matching, and real PostgreSQL row policies via PGlite (with a minimal `auth.uid()` test harness). Browser checks cover persistent local list/item editing, sale filters, mobile overflow, and dialog dismissal. Browser tests force demo configuration and make no paid provider calls.

These checks do **not** replace verification against your hosted Supabase project, email delivery, a live OpenAI product search, and Netlify's scheduled worker. Those require your account configuration and a deployment. Before family use, verify an owner, editor, viewer, unrelated account, and signed-out sharing link against the hosted app, and run Supabase's database advisors.

## Main files

- `app/`: pages, components, local demo, account/list composables, Tailwind/CSS.
- `shared/`: product/list types, input validation, integer-cent pricing.
- `server/api/[...path].ts`: authenticated CRUD, sharing, collaboration, and search endpoints.
- `server/utils/`: authenticated database clients, sourced product research, and price refreshes.
- `netlify/functions/`: daily scheduler and protected background worker.
- `supabase/schema.sql`: initial database bootstrap.
- `supabase/features.sql`: additive price history and family sharing.
- `supabase/search-jobs.sql`: additive private research jobs.

Secret Santa name drawing, gift reservations, target-price alerts, checkout, and notification delivery are outside this version's scope.


## Price history, family hub, and quick capture

For an existing project, run `supabase/features.sql` **once** in the Supabase SQL Editor. For a new project, run `supabase/schema.sql` first, then `supabase/features.sql` and `supabase/search-jobs.sql`. The upgrade preserves lists and items. It seeds one observation from each item’s currently saved offers, using its last successful check time (or creation time for manual entries); it cannot recover prices before Ósk recorded them.

- **Price history:** open an item for a chart of the best price or one retailer, individual source links, lowest observed price, and typical best-price context. Successful price checks save offers and history in the same transaction through a private trigger. Failed checks preserve previous offers without inventing new observations. Name/variant changes are compared separately. Manual entries remain visible in the records but are excluded from sale context. Charts and history return up to one year / 2,000 latest records. The typical price is the median of prior daily minima over 30 days, requiring at least three distinct prior days. MSRP is separate, and changing retailer coverage can affect the best available price.
- **Family hub** (`/family`): create a private family, invite approved Ósk accounts with seven-day links, revoke outstanding invites, and share specific lists. Group membership adds view-only access; it does not grant editing rights. Organizers can rename/delete the hub and remove members; members can leave. Removing membership revokes family access immediately and removes that person’s family shares. Existing individual list permissions and public sharing links remain independent. Profiles in the hub show names/pictures without exposing email addresses.
- **Price-check status:** cards show retailer coverage; item details show successful-check time, last attempt, stale prices, incomplete comparisons, failed checks, and retailer listings without verified prices. Refreshes revisit known priced and unpriced listing URLs and retain unverified links after partial results. Saved diagnostics begin with new searches/checks; older items do not acquire invented research details.
- **Quick capture** (`/capture`): paste a public HTTPS product URL, choose an editable list, preview the exact item and cross-store prices, then explicitly approve it. A manual fallback preserves the source URL and asks for the missing details. Links pasted into dashboard search also use capture mode. `/capture?url=<encoded product URL>` and shared text in `?text=` can prefill the capture form. This is URL-based capture; no browser extension or native mobile share-sheet installation is required.

Schema security is covered by the PGlite/Postgres tests, including default-private families, read-only group access, immediate revocation, append-only snapshots, and failed-check preservation. The live upgrade needs SQL Editor (or a database/management connection); the app’s service-role key cannot execute DDL.


## Item pictures

Run `supabase/item-pictures.sql` once on an existing project. It adds optional image URLs, the originating product page, and a picture preference to each item, with the existing owner/editor RLS permissions. Existing items default to automatic lookup. Image-only edits do not add price history observations.

Product pictures appear on cards, in search previews, and in item details (including signed-out shared lists). Missing, invalid, blocked, or broken pictures use the existing category line artwork. Cards lazy-load pictures, reserve their layout space, and send no referrer to image hosts. Actual colors are preserved in light and dark themes.

Automatic pictures come from known product pages’ Open Graph metadata, matching Product JSON-LD, or the selected Amazon landing image; image URLs are not guessed by a model. Lookup runs beside retailer research and does not delay the first approvable product. Manual saves use a protected `product-image-background` Netlify function; local development uses the persistent Nuxt process. Daily successful checks also fill missing pictures. Lookups share a 5.5-second budget, follow at most two HTTPS redirects, cap HTML at 2 MiB, validate and pin public DNS answers on every hop, and never forward account cookies or credentials. Blocked stores simply leave the fallback in place. The app stores source URLs rather than rehosting retailers’ images.

In **Edit item**, choose automatic lookup, supply a custom public HTTPS photo URL, or choose category artwork only. Custom/category-only choices survive price refreshes and background research. Changing an automatically pictured product name or variant clears its old image for a fresh lookup. The automatic option also lets you clear an existing picture and request another lookup when saving. SVG and executable/data/local image URLs are not accepted as custom photos. No additional OpenAI calls are made for pictures.
