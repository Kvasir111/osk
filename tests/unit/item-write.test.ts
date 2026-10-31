import {describe,it,expect,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
import {writeItem} from '../../server/utils/item-write'
it('keeps normal wishlist saves working before the optional picture schema is installed',async()=>{
 const single=vi.fn().mockResolvedValueOnce({data:null,error:{code:'PGRST204',message:"Could not find the 'image_url' column"}}).mockResolvedValueOnce({data:{id:'item',name:'Book'},error:null})
 const insert=vi.fn((_input:Record<string,unknown>)=>({select:()=>({single})}))
 const db={from:()=>({insert})} as unknown as SupabaseClient
 await expect(writeItem(db,{name:'Book',image_mode:'auto',image_url:null,image_source_url:null})).resolves.toMatchObject({data:{id:'item'}})
 expect(insert.mock.calls.map(call=>call[0])).toEqual([{name:'Book',image_mode:'auto',image_url:null,image_source_url:null},{name:'Book'}])
})
