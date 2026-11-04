import type { SupabaseClient } from '@supabase/supabase-js'
import type { WishItem, SearchResult, ProductDraft, PriceCheckDetails } from '../../shared/types'
import { fillItemPicture } from './product-images'
import { searchProducts } from './product-search'
import { publicUrl } from '../../shared/validation'
import { retailerDomain } from '../../shared/retailers'
import { aiResearchEnabled } from './research-mode'
import { scrapeProducts, savedProductUrls } from './product-scraper'
import { ProductPageError } from './product-page-errors'
import { checkHomeDepot, homeDepotEnabled, homeDepotLink, HomeDepotCheckError } from './home-depot'

function savedListings(item: WishItem) {
  return [...item.offers.map(o => ({ retailer: o.retailer, url: o.url })), ...(item.refresh_status === 'never' ? [] : item.price_check_details?.retailer_checks || [])]
    .filter((entry): entry is { retailer: string; url: string } => !!entry.url && publicUrl.safeParse(entry.url).success)
}
function checkDetails(item: WishItem, result?: SearchResult, product?: ProductDraft): PriceCheckDetails {
  const checks = (result?.retailer_checks || []).map(check => ({ ...check }))
  const priced = new Set((product?.offers || []).map(o => retailerDomain(o.url)))
  for (const listing of savedListings(item)) {
    const domain = retailerDomain(listing.url)
    if (priced.has(domain) || checks.some(check => check.url && retailerDomain(check.url) === domain)) continue
    const retailer = listing.retailer || domain
    const generic = checks.find(check => !check.url && check.retailer.toLowerCase() === retailer.toLowerCase())
    if (generic) generic.url = listing.url
    else checks.push({ retailer, url: listing.url, note: 'Previously saved listing. No current price was verified for this exact variant in the latest check.' })
  }
  return { warnings: result?.warnings || [], retailer_checks: checks.slice(0, 20) }
}

async function mayEdit(db: SupabaseClient, item: WishItem, actorId?: string) {
  if (!actorId) return true // Authenticated scheduled worker.
  const {data:list,error}=await db.from('wish_lists').select('owner_id').eq('id',item.list_id).maybeSingle()
  if(error || !list)return false
  if(list.owner_id===actorId)return true
  const membership=await db.from('list_members').select('role').eq('list_id',item.list_id).eq('user_id',actorId).maybeSingle()
  return !membership.error && membership.data?.role==='editor'
}
export async function refreshItem(db: SupabaseClient, itemId: string, cutoff: string, actorId?: string) {
  const { data, error } = await db.rpc('claim_price_check', { target: itemId, cutoff })
  if (error) throw new Error('Could not claim price check')
  const item = data?.[0] as WishItem | undefined
  if (!item) return 'skipped'
  if (!await mayEdit(db,item,actorId)) return 'skipped'
  let result: SearchResult | undefined
  try {
    const depotUrl=homeDepotEnabled() && homeDepotLink(item)
    result = depotUrl ? await checkHomeDepot(db,item,depotUrl) : aiResearchEnabled()
      ? await searchProducts(`Find current offers for ${item.name}, variant ${item.variant}. Existing listing URLs: ${[...new Set(savedListings(item).map(o => o.url))].slice(0, 20).join(', ')}`, item)
      : await scrapeProducts(savedProductUrls(item), item)
    if (depotUrl) {
      const otherUrls=savedProductUrls(item).filter(url=>url!==depotUrl)
      if(otherUrls.length) {
        const others=await scrapeProducts(otherUrls,item)
        result.products[0]!.offers.push(...others.products.flatMap(product=>product.offers))
        result.sources.push(...others.sources)
        result.retailer_checks=others.retailer_checks
        result.warnings=others.warnings
      }
    }
    const product = result.products.find(p => p.name === item.name && p.variant === item.variant)
    if (!product?.offers.length) throw new Error('No exact, sourced offers found')
    if (!await mayEdit(db,item,actorId)) return 'skipped'
    const { data: saved, error: saveError } = await db.from('wish_items').update({
      price_check_details: checkDetails(item, result, product),
      offers: product.offers, checked_at: result.checked_at, refresh_status: 'ok',
      // Keep the original MSRP baseline once established.
      msrp_cents: item.msrp_cents ?? product.msrp_cents,
      msrp_source_url: item.msrp_source_url ?? product.msrp_source_url,
    }).eq('id', itemId).eq('list_id',item.list_id).eq('status','active').eq('last_attempt_at',item.last_attempt_at!).select('id')
    if (saveError) throw saveError
    if (!saved?.length) return 'skipped'
    try{await fillItemPicture(db,itemId)}catch{/* A missing image must not fail a successful price check. */}
    return 'ok'
  } catch (error) {
    if (!await mayEdit(db,item,actorId)) return 'skipped'
    const { data: saved, error: saveError } = await db.from('wish_items').update({ refresh_status: 'failed', price_check_details: {
      warnings: result?.warnings?.length ? result.warnings : [error instanceof ProductPageError || error instanceof HomeDepotCheckError ? error.message : 'The latest check could not verify current prices for this exact variant. Previous offers were kept.'],
      retailer_checks: checkDetails(item, result).retailer_checks,
    } }).eq('id', itemId).eq('list_id',item.list_id).eq('status','active').eq('last_attempt_at',item.last_attempt_at!).select('id')
    if (saveError) throw new Error('Could not record failed price check')
    if (!saved?.length) return 'skipped'
    return 'failed'
  }
}
