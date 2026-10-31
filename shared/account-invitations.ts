import { z } from 'zod'

export const invitationEmail = z.string().trim().toLowerCase().email().max(254)
export function normalizeInviteCode(value: string) { return value.toUpperCase().replace(/[\s-]/g, '') }
export const invitationCode = z.string().max(100).transform(normalizeInviteCode).pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{24}$/, 'Enter the complete 24-character invitation code.'))
export const createInvitationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('email'), email: invitationEmail }),
  z.object({ kind: z.literal('code') }),
])
export const redeemInvitationSchema = z.object({ code: invitationCode, email: invitationEmail })
export interface AccountInvitation {
  id: string
  kind: 'email' | 'code'
  recipient_email: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  sent_at: string | null
  delivery_status: 'pending' | 'sent' | 'failed'
}
