import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductSearchJob, SearchResult, WishItem } from '../../shared/types'
import { dbResult } from './database-core'
import { resolveProductImage } from './product-images'
import { researchStage, researchTasks, mergeResearch } from './progressive-search'

export async function applyApprovedResearch(db: SupabaseClient, job: ProductSearchJob) {
  if (!job.approved_item_id || !job.approved_snapshot || !job.result || !['completed','failed'].includes(job.status)) return
  const snapshot = job.approved_snapshot
  const product = job.result.products.find(p=>p.name===snapshot.name && p.variant===snapshot.variant)
  if (!product) return
  const list = dbResult(await db.from('wish_lists').select('owner_id').eq('id',snapshot.list_id).maybeSingle())
  if (!list) return
  if (list.owner_id !== job.user_id) {
    const member = dbResult(await db.from('list_members').select('role').eq('list_id',snapshot.list_id).eq('user_id',job.user_id).maybeSingle())
    if (member?.role !== 'editor') return
  }
  const changes = {
    ...(snapshot.image_mode==='auto'&&product.image_url?{image_url:product.image_url,image_source_url:product.image_source_url||null}:{}),
    ...(product.offers.length ? { offers: product.offers, checked_at: job.result.checked_at,
      msrp_cents: snapshot.msrp_cents ?? product.msrp_cents,
      msrp_source_url: snapshot.msrp_source_url ?? product.msrp_source_url } : {}),
    last_attempt_at: job.finished_at || new Date().toISOString(),
    refresh_status: product.offers.length ? 'ok' : 'failed',
    price_check_details: {warnings:job.result.warnings||[],retailer_checks:job.result.retailer_checks||[]},
  }
  // Optimistic guards prevent research from overwriting edits or a newer price check.
  let update = db.from('wish_items').update(changes).eq('id',job.approved_item_id).eq('list_id',snapshot.list_id)
    .eq('name',snapshot.name).eq('variant',snapshot.variant).eq('category',snapshot.category).eq('notes',snapshot.notes)
    .eq('offers',JSON.stringify(snapshot.offers))
  if(snapshot.image_mode){
    update=update.eq('image_mode',snapshot.image_mode)
    update=snapshot.image_url?update.eq('image_url',snapshot.image_url):update.is('image_url',null)
  }
  update = snapshot.checked_at ? update.eq('checked_at',snapshot.checked_at) : update.is('checked_at',null)
  update = snapshot.msrp_cents === null ? update.is('msrp_cents',null) : update.eq('msrp_cents',snapshot.msrp_cents)
  update = snapshot.msrp_source_url === null ? update.is('msrp_source_url',null) : update.eq('msrp_source_url',snapshot.msrp_source_url)
  dbResult(await update)
}

export async function runSearchJob(db: SupabaseClient, id: string) {
  const job = dbResult(await db.from('product_search_jobs').update({status:'running',updated_at:new Date().toISOString()})
    .eq('id',id).eq('status','queued').select('*').maybeSingle()) as ProductSearchJob | null
  if (!job) return // Replayed dispatches never spend another search budget.
  const tasks=researchTasks(job.product_url)
  const stages=tasks.map(task=>({id:task.id,label:task.label,status:'waiting' as 'waiting'|'running'|'completed'|'failed'}))
  const signal=AbortSignal.timeout(110000)
  let result: SearchResult | null=null
  let writes=Promise.resolve()
  const persist = () => {
    const state={stages:structuredClone(stages),result:result ? structuredClone(result):null,updated_at:new Date().toISOString()}
    // Preserve completion order when independent retailers finish at nearly the same time.
    writes=writes.then(async()=>{dbResult(await db.from('product_search_jobs').update(state).eq('id',id))})
    return writes
  }
  try {
    stages[0]!.status='running';await persist()
    const identity=await researchStage(job.query,tasks[0]!,[],signal)
    if(!identity.products.length)throw new Error('The exact product could not be identified. Try a model name or enter its details manually.')
    stages[0]!.status='completed'
    result=mergeResearch(identity,{...identity,products:[],warnings:[]},true)
    await persist() // The product is available for approval before comparison begins.
    const pictures=Promise.all(identity.products.map(product=>resolveProductImage(product,[job.product_url,product.msrp_source_url,...product.offers.map(o=>o.url),...identity.sources.map(source=>source.url)].filter((url):url is string=>!!url)))).then(async products=>{
      result={...result!,products:result!.products.map(product=>{
        const pictured=products.find(p=>p.name===product.name&&p.variant===product.variant&&p.image_url)
        return pictured?{...product,image_url:pictured.image_url,image_source_url:pictured.image_source_url,image_mode:'auto'}:product
      })}
      await persist()
    })
    await Promise.all([pictures,...tasks.slice(1).map(async(task,index)=>{
      const stage=stages[index+1]!
      stage.status='running';await persist()
      try{
        const findings=await researchStage(job.query,task,identity.products,signal)
        stage.status='completed';result=mergeResearch(result!,findings,true)
      }catch{
        stage.status='failed';result=mergeResearch(result!,{...identity,products:[],sources:[],warnings:[`${task.label} check could not finish. Its missing prices have not been verified.`],retailer_checks:[]},true)
      }
      await persist()
    })])
    result=mergeResearch(result!,{...result!,products:[],warnings:[],retailer_checks:[],sources:[]},false)
    const completed=dbResult(await db.from('product_search_jobs').update({status:'completed',result,stages,finished_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq('id',id).select('*').single()) as ProductSearchJob
    await applyApprovedResearch(db,completed)
  }catch{
    for(const stage of stages)if(stage.status==='running')stage.status='failed'
    if(result)result=mergeResearch(result,{...result,products:[],sources:[],warnings:['Some research could not finish. Available prices are kept.'],retailer_checks:[]},false)
    // Keep already-published evidence available when a later stage fails.
    const failed=dbResult(await db.from('product_search_jobs').update({status:'failed',result,stages,
      error_message:result ? 'Some checks could not finish. Available findings are shown.' : 'The product could not be verified. Try a specific model or enter the details manually.',
      finished_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).select('*').single()) as ProductSearchJob
    await applyApprovedResearch(db,failed)
    console.warn('Product research job incomplete', {id})
  }
}

export async function dispatchSearchJob(db: SupabaseClient, id: string) {
  if (process.env.URL) {
    if (!process.env.PRICE_REFRESH_SECRET) throw new Error('Background authentication is not configured')
    // Pin dispatch to this deployment, avoiding alias redirects or a different published version.
    const response=await fetch(new URL('/.netlify/functions/product-search-background',process.env.DEPLOY_URL || process.env.URL),{
      method:'POST',headers:{Authorization:`Bearer ${process.env.PRICE_REFRESH_SECRET}`,'Content-Type':'application/json'},
      body:JSON.stringify({id}),signal:AbortSignal.timeout(10000),redirect:'error',
    })
    if(response.status !== 202)throw new Error('Background dispatch was not accepted')
    return
  }
  if(process.env.NETLIFY || process.env.NODE_ENV==='production')throw new Error('Background URL is not configured')
  // Nuxt dev runs persistently. Production always uses a durable Netlify background invocation.
  void runSearchJob(db,id).catch(()=>console.error('Local product research job failed',{id}))
}

export async function approveSearchItem(db: SupabaseClient, jobId: string, userId: string, snapshot: WishItem) {
  const job=dbResult(await db.from('product_search_jobs').select('*').eq('id',jobId).eq('user_id',userId).maybeSingle()) as ProductSearchJob | null
  if(!job || job.approved_item_id || !job.result?.products.some(p=>p.name===snapshot.name&&p.variant===snapshot.variant))return false
  const bound=dbResult(await db.from('product_search_jobs').update({approved_item_id:snapshot.id,approved_snapshot:snapshot})
    .eq('id',jobId).eq('user_id',userId).is('approved_item_id',null).select('*').maybeSingle()) as ProductSearchJob | null
  if(!bound)return false
  // Covers completion immediately before/while approval was being saved.
  if(['completed','failed'].includes(bound.status))await applyApprovedResearch(db,bound)
  return true
}
