import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { createError, readBody, type H3Event } from 'h3'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { santaSchema, drawSanta, type SantaEvent } from '../../shared/santa'
import { adminDatabase, dbResult } from './database'

export async function santaRequest(event: H3Event, path: string[], db: SupabaseClient, user: User) {
  const [, rawId, action] = path
  const id = z.string().uuid().parse(rawId)
  const method = event.method
  if (path.length === 3 && action === 'events' && (method === 'GET' || method === 'POST')) {
    const family = dbResult(await db.from('families').select('id,owner_id').eq('id', id).maybeSingle())
    if (!family) throw createError({ statusCode: 404, statusMessage: 'Family not found.' })
    if (method === 'GET') return dbResult(await db.from('santa_events').select('*').eq('family_id', id).order('created_at', { ascending: false }))
    if (family.owner_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Only the family organizer can create an event.' })
    const input = santaSchema.parse(await readBody(event))
    return { id: dbResult(await adminDatabase().rpc('mutate_santa', { actor: user.id, target: id, operation: 'create', input })) }
  }
  const santa = dbResult(await db.from('santa_events').select('*').eq('id', id).maybeSingle()) as SantaEvent | null
  if (!santa) throw createError({ statusCode: 404, statusMessage: 'Event not found.' })
  if (path.length === 2 && method === 'GET') {
    const participants = dbResult(await db.from('santa_participants').select('user_id').eq('event_id', id)) || []
    const assignment = dbResult(await db.from('santa_assignments').select('recipient_id').eq('event_id', id).eq('giver_id', user.id).maybeSingle())
    return { event: santa, participants: participants.map(p => p.user_id), recipient_id: assignment?.recipient_id || null }
  }
  let operation = ''
  let input: unknown = {}
  if (path.length === 2 && method === 'PATCH') { operation = 'update'; input = santaSchema.parse(await readBody(event)) }
  if (path.length === 2 && method === 'DELETE') operation = 'delete'
  if (path.length === 3 && method === 'POST' && (action === 'join' || action === 'leave' || action === 'draw')) operation = action
  if (!operation) throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  if (['update', 'delete', 'draw'].includes(operation)) {
    const family = dbResult(await db.from('families').select('owner_id').eq('id', santa.family_id).single())
    if (family?.owner_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Only the family organizer can do that.' })
  }
  if (operation === 'draw') {
    if (santa.drawn_at) throw createError({ statusCode: 409, statusMessage: 'This draw is already locked.' })
    const participants = dbResult(await db.from('santa_participants').select('user_id').eq('event_id', id)) || []
    const assignments = drawSanta(participants.map(p => p.user_id), santa.exclusions, randomInt)
    if (!assignments) throw createError({ statusCode: 400, statusMessage: 'No valid draw is possible. You need at least three participants; try removing an exclusion or adding people.' })
    input = { assignments }
  }
  const { error } = await adminDatabase().rpc('mutate_santa', { actor: user.id, target: id, operation, input })
  if (error) throw createError({ statusCode: 409, statusMessage: 'The event changed or this action is no longer allowed. Reload the event and check its participants and exclusions.' })
  return { ok: true }
}
