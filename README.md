# Ósk

A friends-and-family wishlist built with Nuxt 4, Vue, Tailwind 4, and Supabase, with optional OpenAI research. Deploys to Netlify.

Save products from any store, organize occasion lists, compare offers with manufacturer MSRP, and share lists with your people. Product links are read directly from store pages and require approval before saving. Daily updates revisit saved listing URLs without paid AI calls. The original agent remains available only through an explicit server opt-in. Daily checks run on Netlify.

The Dark mode toggle is available on every page. The initial theme follows the device and updates with it until a light/dark choice is saved in this browser. A saved choice also applies to shared lists, sign-in, and dialogs, and is applied before the page paints.

## Sign-in and passwords

Invited accounts can sign in using **email and password**, or choose **Use an email sign-in link** as a fallback. Existing users and new invitees can open **Edit profile → Set or change your password** after verifying their invitation/sign-in link. Choose a unique password of at least 12 characters. Passwords are submitted directly to Supabase Auth, never the app API, wishlist/profile tables, offline outbox, or analytics. No public signup is added.

**Set or reset your password** on `/login` sends a recovery email for an existing account with a generic confirmation message. Its callback uses the current origin’s `/login?mode=recovery` and preserves allowed invitation/capture return paths. The app holds recovery sessions on the password form rather than redirecting them to the wishlist, and removes callback tokens from the URL. Expired/invalid links offer a fresh request. Setting a password keeps the account’s existing lists, profile, and offline additions.

Keep the Supabase **Email** provider enabled and public signup disabled. Ensure the existing redirect allowlist covers `/login` **including query parameters** on the deployed origin and development origin, such as `https://your-app.example/login**` and `http://localhost:3000/login**`; the exact `/login` entry alone may not cover recovery/invitation callbacks. Set the server’s minimum password length to 12 or stronger if desired; stricter provider requirements are honored. Secure-password-change settings may require a fresh recovery email. Recovery delivery uses your Supabase SMTP configuration. Optional branded **Reset Password** email HTML is in [`supabase/email-templates`](supabase/email-templates/README.md); files and a Netlify deployment do not apply dashboard templates or Auth settings. No SQL migration, new keys, or new environment variables are required.

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
2. Run [`supabase/schema.sql`](supabase/schema.sql), then [`supabase/features.sql`](supabase/features.sql), [`supabase/search-jobs.sql`](supabase/search-jobs.sql), [`supabase/item-pictures.sql`](supabase/item-pictures.sql), [`supabase/account-invitations.sql`](supabase/account-invitations.sql), and [`supabase/secret-santa.sql`](supabase/secret-santa.sql), each **once**, in its SQL Editor. Together they create the tables, RLS policies, grants, and service-only transaction/budget/lease functions. These files are setup SQL, not proof of a live migration. Keep future changes in reviewed migrations; do not rerun the bootstrap on existing tables.
3. In the project's Connect/API settings, get the project URL and publishable key. Put them in `.env` as `NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Add the **server-only** service-role key as `SUPABASE_SERVICE_ROLE_KEY`. It supports token-based shared views, account invitations, and daily workers. It never goes into public runtime config.
5. Configure Supabase Auth:
   - Set Site URL to the deployed origin; add the appropriate local and deployed `/login` redirect URLs, including the `/login?next=...` path needed for collaboration invitations. For local development, allow `http://localhost:3000/**` and the loopback URL if used. Use the deployed origin's `/**` pattern for query-bearing callbacks.
   - Disable public signups and anonymous sign-ins. Bootstrap your own account through **Authentication → Users**. Then use the app’s **Invite people** page for family accounts. The app's sign-in uses `shouldCreateUser: false`.
   - Configure custom SMTP before inviting family members. Supabase's default sender only delivers to organization team addresses and is intended for testing, not family email delivery. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

Restart the dev server after changing public environment values. The app verifies bearer tokens with `auth.getUser()` on every authenticated API request. Since this is a client-rendered Nuxt app (`ssr: false`), browser sessions use the standard Supabase client; there are no server-rendered session cookies to manage.

### Access and sharing

- Owners manage list settings, sharing links, and membership.
- Editors can add, edit, remove, and refresh items. Viewers can read only.
- View-only links require no account. Anyone possessing the link can read that list; links can be disabled or rotated. Raw database access remains unavailable to anonymous visitors.
- Collaboration links require an existing approved account, expire in 7 days, and may be used by multiple recipients. Treat editor invitations as edit access. Owners can revoke outstanding invitations and separately remove existing members.
- Private helper functions use `auth.uid()`, an empty search path, and explicit grants to avoid recursive RLS. They live in the non-exposed `private` schema. Do not add `private` to the Data API's exposed schemas.

## Product page scraping (default)

`PRODUCT_RESEARCH_MODE` defaults to `scrape`. Product capture and daily/manual price refreshes read the HTML of saved public HTTPS product URLs using the existing bounded, DNS-pinned fetcher. No OpenAI key is needed. Known direct model-call entry points and queued agent workers are guarded, so leaving an old OpenAI key configured does not enable spending. Redeploy the updated app and Functions to activate this behavior in production.

Paste a product link instead of a product name. Preview imports unambiguous Product/Offer JSON-LD or product Open Graph metadata, optional photos, explicitly identified USD prices, and stock when stated. It never runs page JavaScript or bypasses login/CAPTCHA. Stores with blocked, missing, ambiguous, marketplace-seller-unknown, subscription, out-of-stock, or non-USD pricing keep the manual fallback. Aggregate price ranges are not exact variant prices. Tax and US shipping remain unverified.

ProductGroup pages (including Rogue colors and rack configurations) can be saved as general items without a price. When the page publishes same-page variant links, preview offers an option picker; reading a selected option preserves its SKU/configuration URL and imports only that exact option’s price and picture. A group’s starting price is never treated as the selected configuration price. Additional rack customizations may change the total; retain the full configuration link and confirm it at the store.

Daily checks revisit up to ten saved priced/unpriced listing URLs, including a captured link in notes, with three concurrent requests and an eight-second lookup budget. They do not discover other stores automatically. Add other retailer URLs through item editing for comparison; price is optional, and unpriced URLs stay in notes for the next check. Fully failed checks keep previous prices; partial checks publish only newly verified offers and retain missing listing URLs in diagnostics. MSRP stays unknown unless the manufacturer is identified and explicitly publishes MSRP; existing baselines stay fixed. History records observations, not reconstructed sale prices. The existing 20-per-account daily lookup budget still applies to interactive checks.

No schema migration is required. No scraper API, paid search service, or headless browser is added.

If a refresh fails, open the item’s **Price check status** for each listing’s reason: blocked access, unavailable page, missing metadata, timeout, redirect, or an unconfirmed product/variant. Review the saved name, variant, and exact SKU/configuration links in **Edit item**; a red item linked to a black SKU cannot be verified. Pages that omit the saved color/size and group pages without a selected configuration cannot supply an exact price. Store blocks remain a manual-price/alternate-link fallback. Failure reasons update on the next check after deployment; old generic diagnostics are not rewritten.

To enter a price manually, use **Store offers → Price in USD** (choose **Add a store** if needed). This is the current price shown on the wishlist card. Optional manufacturer MSRP is a separate comparison baseline; entering MSRP alone does not create a store offer, and the form explains that the current price will remain unknown. Manual prices are saved in cents and do not count as verified sale history.

## Retained OpenAI agent (disabled by default)

The following agent configuration and behavior apply only when a server operator explicitly sets `PRODUCT_RESEARCH_MODE=ai`. Its code and original interface remain in the repository.

Set `OPENAI_API_KEY` in `.env` locally and in Netlify's environment variables for deployment. Keys stay server-side. The default `OPENAI_MODEL` is `gpt-5.5`; it is configurable and must support Responses, web search, reasoning, and structured outputs.

Interactive research uses durable, private Supabase jobs and the protected Netlify `product-search-background` function. The initial API request returns a job ID immediately. A focused lookup identifies the product first (pasted URLs constrain that lookup to their host). It publishes an approvable result, then two independent comparison stages run in parallel. Amazon URLs skip redundant Amazon discovery and check manufacturer MSRP instead. Each stage returns structured findings directly, so there is no separate consolidation model call. The browser polls for new results and shows per-stage progress; the app-level activity notification lets a user leave the dialog, navigate, reload, and resume research.

Approval attaches one saved item to the job. Remaining offers and diagnostics are applied when research finishes, including if the dialog has closed. The worker checks that the approving user still owns/edits the list and uses optimistic field guards to preserve later item edits or newer prices. Repeated dispatches claim a job only once. Research never creates an item without approval. Failed comparison stages retain existing evidence and show incomplete coverage. A queued worker that has not started is reported as failed when polled after 30 seconds; running jobs become retryable failures after three minutes without progress.

**Enter details manually** remains available while research is queued/running, after failures, and when progress cannot reconnect. It keeps a pasted product URL or a typed product name, including when reopening a failed search from the activity notification. You can save without a known price. Manual saves are independent of the research job, so later research cannot overwrite them or create a duplicate item.

For deployed searches that never leave the waiting stages, check the `product-search-background` function log and environment variable scopes. The worker needs `NUXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and the same `PRICE_REFRESH_SECRET` as the API at **Functions runtime**, in the active deploy context. Netlify's initial `202` acknowledges invocation, not successful worker execution. Dispatch rejects redirects and non-`202` responses. Worker logs distinguish rejected authentication, missing variable names, and receipt of a job ID without logging keys, queries, or list contents. See [Netlify runtime variables](https://docs.netlify.com/build/functions/environment-variables/) and [background invocation behavior](https://docs.netlify.com/build/functions/background-functions/).

Standalone workers import `server/utils/database-core.ts`, which has no HTTP framework dependency. Keep `h3` and request authentication helpers in `server/utils/database.ts` on the Nitro side. Bundling the HTTP helper into standalone functions previously produced a deployed `Cannot find module 'ufo'` crash during startup. `pnpm run test:functions` uses Netlify's pinned function packager, loads all four packaged handlers outside the repository, and checks rejection paths without credentials or network access. The production build runs this check after generating the PWA, so an app build alone cannot hide a custom-worker startup failure.

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
| `PRODUCT_RESEARCH_MODE` | Server-only; defaults to `scrape`; `ai` explicitly restores paid research |
| `OPENAI_API_KEY` | Optional server-only OpenAI key, used only in `ai` mode |
| `INVITATION_ADMIN_EMAILS` | Server-only, comma-separated verified email addresses allowed to create account invitations |
| `OPENAI_MODEL` | Optional; defaults to `gpt-5.5` |
| `OPENAI_SEARCH_MODEL` | Optional override for interactive background research |
| `OPENAI_EXTRACTION_MODEL` | Optional formatter for legacy/daily synchronous checks |
| `PRICE_REFRESH_SECRET` | Random server-only worker secret |

Generate the worker secret with `openssl rand -hex 32`. Netlify supplies `URL` automatically for dispatch to the same site's workers. Opted-in AI jobs require `product-search-background` and the existing `PRICE_REFRESH_SECRET`; production does not use an in-memory fallback. Local Nuxt development runs jobs in its persistent dev process. A running local job can be interrupted by a server restart; its saved findings remain recoverable and stalled jobs can be retried. Rebuild after public config changes. Do not publish `.env`, secret keys, or a database password.

Model names are public configuration. `netlify.toml` excludes only `OPENAI_MODEL` from environment-value secret scanning, so its documented default does not block deployment if the variable was marked secret in Netlify. API keys and worker secrets remain covered by scanning. Configure model variables as non-secret values when adding them in Netlify.

### Daily refresh

`daily-prices` runs at **12:00 UTC every day** (7 a.m. Chicago during daylight saving time; 6 a.m. standard time). It finds items not attempted since UTC midnight and dispatches batches of ten to `refresh-prices-background`. Each worker validates a secret and atomically leases items through a service-only RPC, preventing duplicate checks by overlapping workers. Each default scraping lookup shares an eight-second budget across saved URLs; optional AI checks retain their 48-second deadline. Batches stay below the background function's 15-minute limit. [Netlify scheduling](https://docs.netlify.com/build/functions/scheduled-functions/), [background functions](https://docs.netlify.com/build/functions/background-functions/).

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

These checks do **not** replace verification against your hosted Supabase project, email delivery, live retailer page access (and OpenAI only if explicitly enabled), and Netlify's scheduled worker. Those require your account configuration and a deployment. Before family use, verify an owner, editor, viewer, unrelated account, and signed-out sharing link against the hosted app, and run Supabase's database advisors.

## Main files

- `app/`: pages, components, local demo, account/list composables, Tailwind/CSS.
- `shared/`: product/list types, input validation, integer-cent pricing.
- `server/api/[...path].ts`: authenticated CRUD, sharing, collaboration, and search endpoints.
- `server/utils/`: authenticated database clients, sourced product research, and price refreshes.
- `netlify/functions/`: daily scheduler and protected background worker.
- `supabase/schema.sql`: initial database bootstrap.
- `supabase/features.sql`: additive price history and family sharing.
- `supabase/search-jobs.sql`: additive private research jobs.
- `supabase/secret-santa.sql`: additive family events, opt-in participants, and private assignments.

Gift reservations, target-price alerts, checkout, and notification delivery are outside this version's scope.


## Price history, family hub, and quick capture

For an existing project, run `supabase/features.sql` **once** in the Supabase SQL Editor. For a new project, run `supabase/schema.sql` first, then `supabase/features.sql` and `supabase/search-jobs.sql`. The upgrade preserves lists and items. It seeds one observation from each item’s currently saved offers, using its last successful check time (or creation time for manual entries); it cannot recover prices before Ósk recorded them.

- **Price history:** open an item for a chart of the best price or one retailer, individual source links, lowest observed price, and typical best-price context. Successful price checks save offers and history in the same transaction through a private trigger. Failed checks preserve previous offers without inventing new observations. Name/variant changes are compared separately. Manual entries remain visible in the records but are excluded from sale context. Charts and history return up to one year / 2,000 latest records. The typical price is the median of prior daily minima over 30 days, requiring at least three distinct prior days. MSRP is separate, and changing retailer coverage can affect the best available price.
- **Family hub** (`/family`): create a private family, invite approved Ósk accounts with seven-day links, revoke outstanding invites, and share specific lists. Group membership adds view-only access; it does not grant editing rights. Organizers can rename/delete the hub and remove members; members can leave. Removing membership revokes family access immediately and removes that person’s family shares. Existing individual list permissions and public sharing links remain independent. Profiles in the hub show names/pictures without exposing email addresses.
- **Price-check status:** cards show retailer coverage; item details show successful-check time, last attempt, stale prices, incomplete comparisons, failed checks, and retailer listings without verified prices. Refreshes revisit known priced and unpriced listing URLs and retain unverified links after partial results. Saved diagnostics begin with new searches/checks; older items do not acquire invented research details.
- **Quick capture** (`/capture`): paste a public HTTPS product URL, choose an editable list, preview the exact item and cross-store prices, then explicitly approve it. A manual fallback preserves the source URL and asks for the missing details. Links pasted into dashboard search also use capture mode. Shared URL, text, and title parameters can prefill the capture form; receiving a share never starts paid research or saves an item automatically.

## Secret Santa

Run `supabase/secret-santa.sql` once on the existing project, after `features.sql`. This additive upgrade creates event, opt-in participant, and private assignment tables without changing wishlist access. On a fresh project, apply it after the other setup SQL files. No new environment variables are needed.

Open **Family hub**, choose a family, and use **Secret Santa**. The family organizer creates an event with an optional USD gift budget, exchange date, and excluded pairs such as partners. Exclusions apply in both directions and are visible to the family. Invite people using the existing family invitation flow; each member joins the event for themselves. Events support 3–50 participants.

Save settings before choosing **Draw names**. The server uses randomized matching, checks the complete draw against the current roster and exclusions, and commits all assignments atomically. Impossible constraints leave the event open so the organizer can adjust them. Once drawn, settings and participation lock; there is no redraw operation. Deleting an event permanently removes its assignments; create a new event if the group needs to start over.

Each participant sees only their own recipient, including when the participant is the organizer. RLS enforces this on direct database reads as well as API responses. The recipient panel links only to lists already shared with the family; an event grants no additional wishlist access. Leaving the family revokes event and assignment reads. A participant who leaves before drawing must rejoin, leave the open event, or the organizer must start a new event. Account deletion can remove that person's assignments; a changed group should start over. Events and assignments require a connection and are not cached offline or sent by email.

## Mobile share shortcut

The PWA manifest registers a GET share target at `/capture` for `url`, `text`, and `title`, plus an **Add a wish** app shortcut. On supported browsers, install the deployed Ósk PWA, open a product page in another app, and choose Ósk from its share menu. Existing installations may need to reopen or reinstall to receive updated manifest registration. Actual OS share-menu registration requires checking on a device; browser tests verify the manifest and receiving flow.

[Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target) support varies. On iPhone/iPad and other unsupported browsers, choose **Copy Link**, open **Quick capture**, and paste. A public HTTPS URL is required; shared titles are editable suggestions, not verified product identity. Signing in preserves the capture return path. GET shares put product links/titles in the navigation URL, so do not share private or credential-bearing URLs.

Offline, use manual entry to save into an editable cached list. Leaving the captured price blank saves its URL in item notes and creates no offer or price-history claim; the combined note and link must fit the existing 2,000-character note limit. The account-scoped outbox syncs it after reconnect. Research and price comparisons require a connection. This feature shares links, not photo files; Photo Quick Add remains a local-reference stub.

Schema security is covered by the PGlite/Postgres tests, including default-private families, read-only group access, immediate revocation, append-only snapshots, and failed-check preservation. The live upgrade needs SQL Editor (or a database/management connection); the app’s service-role key cannot execute DDL.


## Item pictures

Run `supabase/item-pictures.sql` once on an existing project. It adds optional image URLs, the originating product page, and a picture preference to each item, with the existing owner/editor RLS permissions. Existing items default to automatic lookup. Image-only edits do not add price history observations.

Product pictures appear on cards, in search previews, and in item details (including signed-out shared lists). Missing, invalid, blocked, or broken pictures use the existing category line artwork. Cards lazy-load pictures, reserve their layout space, and send no referrer to image hosts. Actual colors are preserved in light and dark themes.

Automatic pictures come from known product pages’ Open Graph metadata, matching Product JSON-LD, or the selected Amazon landing image; image URLs are not guessed by a model. Lookup runs beside retailer research and does not delay the first approvable product. Manual saves use a protected `product-image-background` Netlify function; local development uses the persistent Nuxt process. Daily successful checks also fill missing pictures. Lookups share a 5.5-second budget, follow at most two HTTPS redirects, cap HTML at 2 MiB, validate and pin public DNS answers on every hop, and never forward account cookies or credentials. Blocked stores simply leave the fallback in place. The app stores source URLs rather than rehosting retailers’ images.

In **Edit item**, choose automatic lookup, supply a custom public HTTPS photo URL, or choose category artwork only. Custom/category-only choices survive price refreshes and background research. Changing an automatically pictured product name or variant clears its old image for a fresh lookup. The automatic option also lets you clear an existing picture and request another lookup when saving. SVG and executable/data/local image URLs are not accepted as custom photos. No additional OpenAI calls are made for pictures.

## Account invitations

Run `supabase/account-invitations.sql` once in the Supabase SQL Editor. Add `INVITATION_ADMIN_EMAILS` to the server environment in Netlify and locally; include your verified sign-in email. No administrator is enabled by default, and user-editable profile metadata never grants this permission. Redeploy after changing server configuration.

Open **Invite people** to send an email invitation or generate a code/link. Codes carry 120 bits of randomness, are stored only as SHA-256 hashes, expire in seven days, and bind atomically to the first email that uses them. The full code is displayed once. Share links put the code in a fragment, which the join page removes from browser history. Recipients can also enter a code at `/join`; the login page links there.

New accounts are created using Supabase’s server-only invitation API. Existing accounts receive an ordinary magic link with automatic signup disabled. Both return to `/login?next=%2Fprofile` on the configured Netlify `URL`, so the production origin and its login callback must be allowed in Supabase. Public signup can remain disabled. Configure custom SMTP to deliver to friends and family; Supabase’s default sender is restricted to project-team addresses.

Branded **Invite user** and **Magic Link** HTML bodies, suggested subjects, and installation instructions live in [`supabase/email-templates`](supabase/email-templates/README.md). Apply them in Supabase’s email-template settings; deploying the app does not update hosted email templates. Both preserve Supabase’s generated confirmation URL and use Ósk’s colors with mobile and optional dark-mode styling.

Each configured administrator may create 20 invitations per rolling 24 hours. Each invitation allows five email delivery attempts at least 60 seconds apart, including failed attempts; retrying a code uses the same email. Administrators can see, resend, and revoke their own invitations. Revocation blocks further claims and resends but does not delete accounts or invalidate authentication emails already sent. Account invitations grant no family or wishlist permissions; those remain separate sharing actions.

## PWA and offline additions

Deploy over HTTPS, open Ósk online once, and let your lists load. **Install Ósk** in the sidebar opens the browser installation prompt when available, or gives iPhone/iPad and browser-menu instructions. The manifest includes standalone display and standard, maskable, and Apple icons. Service workers are enabled in production builds; the development server stays network-only.

Previously loaded lists, wishes, and prices are saved in IndexedDB for the signed-in account. Offline, you can browse those lists and add manual wishes or create new lists. The status bar identifies cached data and unsynced additions. Product pictures use the category fallback when their external hosts are unavailable. Existing-item edits/deletes, research, profile changes, sharing, invitations, and fresh price checks require a connection. The photo-capture stub remains a temporary local reference, without photo upload.

Additions are written durably before submitting. Sync runs when the app reconnects, regains focus, or is next opened online, and retries pending additions every 30 seconds while open. New lists sync before their wishes. Stable client UUIDs make retries idempotent without another database upgrade, and server RLS rechecks current access. A lost response cannot create a second copy or overwrite the original. An older in-flight refresh cannot hide a newer local save. Failed permission or validation checks retain the draft for review/removal; Retry sync retries blocked additions too. Authentication failures keep the queue until that same account signs in again. This does not depend on browser-specific closed-app background sync.

Snapshots and queues are scoped to account IDs; credentials are not copied into IndexedDB or worker caches. The usual Supabase browser session remains in its SDK-managed storage. Switching accounts does not display or submit another account’s additions. Explicit sign-out removes that account’s offline data and asks for confirmation if it has unsynced additions. Browser/device storage must remain available until synchronization finishes.

`pnpm run build` prerenders a public app shell and runs `scripts/build-pwa.mjs` to precache this build’s public scripts, styles, icons, and routing metadata. The worker never caches API responses, authorization-bearing requests, or third-party content. New worker versions wait until existing app windows close, then clean up older shell caches. No automatic reload interrupts an open form.

To run the production-worker tests in an isolated checkout, build with the test-only public configuration and then run `pnpm test:pwa`:

```sh
NUXT_PUBLIC_SUPABASE_URL=https://qa.supabase.co NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_only pnpm build
pnpm test:pwa
```

The tests use a local static server and mocked APIs, with real browser service workers and IndexedDB. They cover offline reloads, new-list dependencies, dropped-response retries, stale-refresh races, revoked access, expired offline sessions, account isolation, fresh prices on reconnect, and sign-out cleanup.
