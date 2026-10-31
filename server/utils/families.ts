import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createError, readBody, type H3Event } from 'h3'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { adminDatabase, dbResult } from './database'
import { profileForUser } from './profiles'
const uuid = z.string().uuid()
const familySchema = z.object({ name: z.string().trim().min(1).max(100) })
export async function familyRequest(event: H3Event, path: string[], db: SupabaseClient, user: User) {
  const [resource, id, action] = path
  const method = event.method
  if (resource === 'family-join' && id && path.length === 2 && method === 'POST') {
    uuid.parse(id)
    const admin = adminDatabase()
    const invite = dbResult(await admin.from('family_invites').select('*').eq('token', id).gt('expires_at', new Date().toISOString()).maybeSingle())
    if (!invite) throw createError({ statusCode: 404, statusMessage: 'This family invitation has expired or was revoked.' })
    const family = dbResult(await admin.from('families').select('owner_id').eq('id', invite.family_id).single())
    if (!family) throw createError({ statusCode: 404, statusMessage: 'Family not found.' })
    if (family.owner_id !== user.id) dbResult(await admin.from('family_members').upsert({ family_id: invite.family_id, user_id: user.id }))
    return { family_id: invite.family_id }
  }
  if (resource !== 'families') throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  if (path.length === 1) {
    if (method === 'GET') return dbResult(await db.from('families').select('*').order('created_at'))
    if (method === 'POST') {
      const id = randomUUID()
      dbResult(await db.from('families').insert({ ...familySchema.parse(await readBody(event)), id, owner_id: user.id }))
      // A separate statement also supports projects using the original membership-based SELECT policy.
      return dbResult(await db.from('families').select('*').eq('id', id).single())
    }
  }
  uuid.parse(id)
  const family = dbResult(await db.from('families').select('*').eq('id', id).maybeSingle())
  if (!family) throw createError({ statusCode: 404, statusMessage: 'Family not found.' })
  const owner = () => {
    if (family.owner_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Only the family organizer can do that.' })
  }
  if (path.length === 2) {
    if (method === 'GET') {
      const memberships = dbResult(await db.from('family_members').select('user_id').eq('family_id', id)) || []
      const admin = adminDatabase()
      const members = await Promise.all([family.owner_id, ...memberships.map(m => m.user_id)].filter((value, index, all) => all.indexOf(value) === index).map(async userId => {
        const { data } = await admin.auth.admin.getUserById(userId)
        const profile = data.user ? await profileForUser(admin, data.user) : null
        // Family members see display identity, never each other's private email addresses.
        return { user_id: userId, display_name: profile?.display_name || 'Family member', avatar_url: profile?.avatar_url || null }
      }))
      const links = dbResult(await db.from('family_lists').select('list_id').eq('family_id', id))
      return { family, members, links }
    }
    if (method === 'PATCH') { owner(); return dbResult(await db.from('families').update(familySchema.parse(await readBody(event))).eq('id', id).select().single()) }
    if (method === 'DELETE') { owner(); dbResult(await db.from('families').delete().eq('id', id)); return { ok: true } }
  }
  if (path.length !== 3) throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  if (action === 'lists' && (method === 'POST' || method === 'DELETE')) {
    const { list_id } = z.object({ list_id: uuid }).parse(await readBody(event))
    // Database policies limit sharing to lists owned by the caller, and unsharing to owner/organizer.
    if (method === 'POST') return dbResult(await db.from('family_lists').insert({ family_id: id, list_id }).select().single())
    dbResult(await db.from('family_lists').delete().eq('family_id', id).eq('list_id', list_id)); return { ok: true }
  }
  if (action === 'invite') {
    owner()
    if (method === 'POST') return dbResult(await adminDatabase().from('family_invites').insert({ family_id: id }).select('token,expires_at').single())
    if (method === 'DELETE') { dbResult(await adminDatabase().from('family_invites').delete().eq('family_id', id)); return { ok: true } }
  }
  if (action === 'members' && method === 'DELETE') {
    const { user_id } = z.object({ user_id: uuid }).parse(await readBody(event))
    if (user_id !== user.id) owner()
    if (user_id === family.owner_id) throw createError({ statusCode: 400, statusMessage: 'The organizer must delete the family instead of leaving.' })
    const admin = adminDatabase()
    // Remove this member's shares before membership so a later rejoin won't silently reshare them.
    const lists = dbResult(await admin.from('wish_lists').select('id').eq('owner_id', user_id)) || []
    if (lists.length) dbResult(await admin.from('family_lists').delete().eq('family_id', id).in('list_id', lists.map(l => l.id)))
    dbResult(await admin.from('family_members').delete().eq('family_id', id).eq('user_id', user_id))
    return { ok: true }
  }
  throw createError({ statusCode: 404, statusMessage: 'Not found.' })
}
