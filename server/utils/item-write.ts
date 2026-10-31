import type {SupabaseClient} from '@supabase/supabase-js'
// Keep ordinary wishes usable during rollout before the optional image columns exist.
export async function writeItem(db:SupabaseClient,values:Record<string,unknown>,id?:string) {
  const write=(input:Record<string,unknown>)=>{
    const query=id?db.from('wish_items').update(input).eq('id',id):db.from('wish_items').insert(input)
    return query.select().single()
  }
  const saved=await write(values)
  if(saved.error&&['PGRST204','42703'].includes(saved.error.code)&&/image_(url|source_url|mode)/.test(saved.error.message)&&!['custom','none'].includes(String(values.image_mode))){
    const {image_url:_url,image_source_url:_source,image_mode:_mode,...legacy}=values
    return write(legacy)
  }
  return saved
}
