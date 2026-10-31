import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { adminDatabase } from '../../server/utils/database'
import { fillItemPicture } from '../../server/utils/product-images'
export default async(request:Request)=>{
  const expected=Buffer.from(`Bearer ${process.env.PRICE_REFRESH_SECRET||''}`),received=Buffer.from(request.headers.get('Authorization')||'')
  if(!process.env.PRICE_REFRESH_SECRET||expected.length!==received.length||!timingSafeEqual(expected,received))return new Response('Unauthorized',{status:401})
  if(request.method!=='POST')return new Response('Method not allowed',{status:405})
  const input=z.object({id:z.string().uuid()}).safeParse(await request.json().catch(()=>null))
  if(!input.success)return new Response('Invalid request',{status:400})
  await fillItemPicture(adminDatabase(),input.data.id)
  return new Response(null,{status:204})
}
