import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { adminDatabase } from '../../server/utils/database-core'
import { refreshItem } from '../../server/utils/refresh-prices'

export default async (request: Request) => {
  const expected = Buffer.from(`Bearer ${process.env.PRICE_REFRESH_SECRET || ''}`)
  const received = Buffer.from(request.headers.get('Authorization') || '')
  if (!process.env.PRICE_REFRESH_SECRET || received.length !== expected.length || !timingSafeEqual(received, expected))
    return new Response('Unauthorized', { status: 401 })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(10), cutoff: z.string().datetime() }).safeParse(await request.json())
  if (!parsed.success) return new Response('Invalid request', { status: 400 })
  const db = adminDatabase()
  for (const id of parsed.data.ids) {
    const status = await refreshItem(db, id, parsed.data.cutoff)
    // IDs and status only: no list content, secrets, or provider responses in logs.
    console.info('Price check', id, status)
  }
  return new Response(null, { status: 204 })
}
