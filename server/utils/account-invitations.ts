import { createHash, randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createError, readBody, type H3Event } from 'h3'
import { z } from 'zod'
import { createInvitationSchema, normalizeInviteCode, redeemInvitationSchema } from '../../shared/account-invitations'
import { adminDatabase, databaseConfig, dbResult } from './database'

const columns = 'id,kind,recipient_email,created_at,expires_at,revoked_at,sent_at,delivery_status'
export function canInviteAccounts(user: User) {
  const admins = (process.env.INVITATION_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return !!user.email_confirmed_at && !!user.email && admins.includes(user.email.toLowerCase())
}
export function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // 24 independent symbols, 120 bits; no ambiguous 0/1/I/O characters.
  return Array.from(randomBytes(24), b => alphabet[b & 31]).join('').match(/.{4}/g)!.join('-')
}
export function hashInviteCode(code: string) { return createHash('sha256').update(normalizeInviteCode(code)).digest('hex') }
export function invitationRedirect() {
  const configured = process.env.URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')
  if (!configured) throw createError({ statusCode: 503, statusMessage: 'Configure the deployed site URL before sending invitations.' })
  const redirect = new URL('/login', configured)
  if (redirect.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && redirect.hostname === 'localhost')) {
    throw createError({ statusCode: 503, statusMessage: 'Invitations need a secure site URL.' })
  }
  redirect.searchParams.set('next', '/profile')
  return redirect.href
}
export async function deliverInvitation(admin: SupabaseClient, id: string, email: string, redirectTo: string) {
  const reserved = dbResult(await admin.rpc('reserve_account_invitation', { target_id: id, email_address: email }))
  if (!reserved) throw createError({ statusCode: 400, statusMessage: 'This invitation is unavailable, belongs to another email, or was just used. Wait a minute before retrying.' })
  let succeeded = false
  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (error) {
      // Existing accounts get an ordinary sign-in email; no user enumeration reaches callers.
      if (!['email_exists', 'user_already_exists'].includes(error.code || '')) throw error
      const { url, key } = databaseConfig()
      const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      const sent = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })
      if (sent.error) throw sent.error
    }
    succeeded = true
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'The invitation email could not be sent. Check email delivery settings or try again in a minute.' })
  } finally {
    // Delivery diagnostics contain no tokens or raw authentication errors.
    const { error } = await admin.from('account_invitations').update({ delivery_status: succeeded ? 'sent' : 'failed', ...(succeeded ? { sent_at: new Date().toISOString() } : {}) }).eq('id', id)
    if (error) console.warn('Invitation delivery status could not be saved')
  }
}
export async function redeemAccountInvitation(event: H3Event) {
  const input = redeemInvitationSchema.parse(await readBody(event))
  const redirect = invitationRedirect()
  const admin = adminDatabase()
  const invite = dbResult(await admin.from('account_invitations').select('id').eq('kind', 'code').eq('code_hash', hashInviteCode(input.code)).maybeSingle())
  if (!invite) throw createError({ statusCode: 400, statusMessage: 'This invitation is unavailable. Check the code or ask for a new one.' })
  await deliverInvitation(admin, invite.id, input.email, redirect)
  return { ok: true }
}
export async function accountInvitationRequest(event: H3Event, path: string[], user: User) {
  const allowed = canInviteAccounts(user)
  if (event.method === 'GET' && path.length === 1 && !allowed) return { can_invite: false, invitations: [] }
  if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Only an app invitation administrator can invite new accounts.' })
  const admin = adminDatabase()
  if (path.length === 1 && event.method === 'GET') {
    const invitations = dbResult(await admin.from('account_invitations').select(columns).eq('created_by', user.id).order('created_at', { ascending: false }).limit(100))
    return { can_invite: true, invitations }
  }
  if (path.length === 1 && event.method === 'POST') {
    const input = createInvitationSchema.parse(await readBody(event))
    const redirect = invitationRedirect()
    const code = generateInviteCode()
    const { data, error } = await admin.rpc('create_account_invitation', { actor: user.id, invite_kind: input.kind, token_hash: hashInviteCode(code), email_address: input.kind === 'email' ? input.email : null })
    if (error?.code === 'P0001') throw createError({ statusCode: 429, statusMessage: 'You can create 20 invitations per day. Try again tomorrow.' })
    const invite = dbResult({ data, error })?.[0]
    if (!invite) throw createError({ statusCode: 503, statusMessage: 'Invitation storage is not available. Check the database setup.' })
    if (input.kind === 'email') await deliverInvitation(admin, invite.id, input.email, redirect)
    return { id: invite.id, ...(input.kind === 'code' ? { code } : {}) }
  }
  const id = z.string().uuid().parse(path[1])
  const invite = dbResult(await admin.from('account_invitations').select('id,recipient_email').eq('id', id).eq('created_by', user.id).maybeSingle())
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitation not found.' })
  if (event.method === 'DELETE' && path.length === 2) {
    dbResult(await admin.from('account_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('created_by', user.id))
    return { ok: true }
  }
  if (event.method === 'POST' && path.length === 3 && path[2] === 'resend') {
    if (!invite.recipient_email) throw createError({ statusCode: 400, statusMessage: 'This code has not been claimed yet.' })
    await deliverInvitation(admin, id, invite.recipient_email, invitationRedirect())
    return { ok: true }
  }
  throw createError({ statusCode: 404, statusMessage: 'Not found.' })
}
