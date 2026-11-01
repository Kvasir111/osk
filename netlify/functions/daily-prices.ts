import { adminDatabase } from '../../server/utils/database-core'

// Dispatch quickly; the background worker has a 15-minute execution window.
export default async () => {
  const secret = process.env.PRICE_REFRESH_SECRET
  const site = process.env.URL
  if (!secret || !site || !process.env.OPENAI_API_KEY) throw new Error('Daily price refresh environment is incomplete')
  const db = adminDatabase()
  const cutoff = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
  let after = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await db.from('wish_items').select('id').gt('id', after)
      .or(`last_attempt_at.is.null,last_attempt_at.lt.${cutoff}`).order('id').limit(500)
    if (error) throw new Error('Could not read due items')
    if (!data.length) break
    const batches: string[][] = []
    for (let i = 0; i < data.length; i += 10) batches.push(data.slice(i, i + 10).map(item => item.id))
    await Promise.all(batches.map(async ids => {
      const response = await fetch(new URL('/.netlify/functions/refresh-prices-background', site), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ ids, cutoff }), signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('Price worker dispatch failed')
    }))
    after = data[data.length - 1]!.id
    if (data.length < 500) break
  }
  return new Response(null, { status: 204 })
}
