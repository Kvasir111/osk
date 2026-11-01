import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { adminDatabase } from '../../server/utils/database-core'
import { runSearchJob } from '../../server/utils/search-jobs'
export default async (request: Request) => {
  const expected=Buffer.from(`Bearer ${process.env.PRICE_REFRESH_SECRET||''}`)
  const received=Buffer.from(request.headers.get('Authorization')||'')
  if(!process.env.PRICE_REFRESH_SECRET || expected.length!==received.length || !timingSafeEqual(expected,received)) {
    console.warn('Product research worker rejected request', { reason: process.env.PRICE_REFRESH_SECRET ? 'authorization' : 'missing_worker_secret' })
    return new Response('Unauthorized',{status:401})
  }
  if(request.method!=='POST')return new Response('Method not allowed',{status:405})
  const parsed=z.object({id:z.string().uuid()}).safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return new Response('Invalid request',{status:400})
  const missing = ['NUXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'].filter(name => !process.env[name])
  if (missing.length) {
    console.error('Product research worker configuration missing', { id: parsed.data.id, variables: missing })
    throw new Error('Product research worker configuration missing')
  }
  console.info('Product research worker received job', { id: parsed.data.id })
  try { await runSearchJob(adminDatabase(),parsed.data.id) }
  catch {
    console.error('Product research worker failed before completion', { id: parsed.data.id })
    throw new Error('Product research worker failed before completion')
  }
  return new Response(null,{status:204})
}
