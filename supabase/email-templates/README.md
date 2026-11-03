# Ósk authentication emails

Paste-ready HTML for the existing Supabase authentication flow. These files are not applied to the hosted project by a Netlify deployment or SQL migration.

| Supabase template | Subject | HTML body |
| --- | --- | --- |
| Invite user | You’re invited to Ósk | [invite-user.html](invite-user.html) |
| Magic Link | Your sign-in link for Ósk | [magic-link.html](magic-link.html) |
| Reset Password | Set your password for Ósk | [reset-password.html](reset-password.html) |

## Apply in Supabase

1. Open the Ósk Supabase project and go to **Authentication → Email Templates** (or **Emails → Templates**, depending on the dashboard navigation).
2. Choose **Invite user**, enter its subject above, and paste the entire contents of `invite-user.html` into the HTML/message body. Save.
3. Choose **Magic Link**, enter its subject above, paste `magic-link.html`, and save.
4. Keep **Site URL** set to the deployed app origin. Keep the app’s `/login` redirect URLs, including query-bearing invitation callbacks, in the redirect allowlist.
5. Optionally choose **Reset Password**, use the subject above, and paste `reset-password.html`. Keep query-bearing `/login?mode=recovery` callbacks allowed too. The default Supabase recovery template also works; this file adds Ósk’s styling.

The buttons and fallback links must keep `{{ .ConfirmationURL }}` exactly. Supabase supplies the verification link and the app-requested return destination. Do not replace it with `{{ .SiteURL }}`, `{{ .RedirectTo }}`, or a hardcoded app link: those alone do not verify the invitation/sign-in token. The footer’s ordinary app link uses `{{ .SiteURL }}`.

The invitation template welcomes new accounts. Existing users who receive an invitation get the Magic Link template, which also serves ordinary sign-in requests. An account invitation does not join a family or grant access to a wishlist; those invitations remain separate app flows.

## Design and delivery

- All three emails use Ósk’s muted Nordic colors, a text wordmark, inline styles, table-based layout, and mobile sizing. They need no external images, fonts, JavaScript, or app stylesheet.
- Optional dark styles enhance supporting mail clients. The inline light styles remain the fallback; rendering can vary by client.
- Hidden preview text gives inboxes useful summaries. Each email has a descriptive action button and a secondary link to the same generated confirmation URL.
- Link expiry follows your Supabase Auth settings; no fixed expiry is promised in the copy.
- Configure the sender display name as **Ósk**, with an address on your verified sending domain, in Supabase’s custom SMTP settings. HTML templates do not change the sender identity. Do not enter SMTP credentials in these files.
- Disable SMTP-provider click tracking for authentication emails to avoid rewriting verification links. Some mail-security scanners can also consume single-use links; see Supabase’s email-template guidance before changing authentication behavior to address that.

After saving, check the dashboard preview and send an intentional test invitation to an address you control. Verify a new-user invitation and an existing-user sign-in, the destination after clicking, and the email in your usual mobile/desktop clients. Local HTML previews cannot verify Supabase rendering, SMTP delivery, or mail-client-specific behavior. No live emails are sent by creating or previewing these files.

References: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
