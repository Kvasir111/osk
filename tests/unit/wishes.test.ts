import {describe,it,expect} from 'vitest'
import { duplicateWishes, filterWishes, priceEvidenceChanged, wishUrl } from '../../shared/wishes'
import type { ProductDraft, WishItem } from '../../shared/types'
const product: ProductDraft={name:'A book',variant:'Hardcover',category:'Books',notes:'',msrp_cents:null,msrp_source_url:null,offers:[{retailer:'Shop',url:'https://shop.example.com/book?variant=hardcover&utm_source=friend',price_cents:2500,seller_type:'retailer',us_shipping:'unknown',availability:'unknown',shipping_note:''}]}
const item:WishItem={...product,id:'one',list_id:'birthday',created_at:'2026-01-01',checked_at:null,last_attempt_at:null,refresh_status:'never',gift_preferences:'Blue cover',priority:'really_want'}
const filters={query:'',listId:'',category:'',status:'active',min:'',max:'',priority:''}
describe('Saved wishes',()=>{
  it('ignores tracking parameters but preserves product and variant query parameters',()=>{
    expect(wishUrl(product.offers[0]!.url)).toBe('https://shop.example.com/book?variant=hardcover')
    expect(duplicateWishes({...product,name:'Different title',offers:[{...product.offers[0]!,url:'https://www.shop.example.com/book/?variant=hardcover&ref=friend#reviews'}]},[item])).toEqual([item])
    expect(duplicateWishes({...product,variant:'Paperback'},[item])).toEqual([])
  })
  it('finds identical names and variants even for wishes without links',()=>{
    expect(duplicateWishes({...product,name:' A BOOK ',offers:[]},[item])).toEqual([item])
    expect(duplicateWishes({...product,name:'Different book',offers:[]},[item])).toEqual([])
  })
  it('searches preferences, names, variants, notes and retailers together with list, status and price filters',()=>{
    const archived={...item,id:'two',status:'archived' as const,list_id:'christmas'}
    const unknown={...item,id:'unknown',offers:[]}
    expect(filterWishes([item,archived,unknown],{...filters,query:'blue shop',min:'20',max:'30',listId:'birthday',category:'Books',priority:'really_want'})).toEqual([item])
    expect(filterWishes([item,archived],{...filters,status:'archived'})).toEqual([archived])
    expect(filterWishes([item],{...filters,max:'24.99'})).toEqual([])
  })
  it('keeps verified price evidence for notes, preferences and picture changes despite JSON key order',()=>{
    // Build a genuinely reordered offer, rather than dropping nested keys.
    const offer=Object.fromEntries(Object.entries(product.offers[0]!).reverse())
    expect(priceEvidenceChanged(product,{...product,notes:'Later',status:'archived',gift_preferences:'Blue',offers:[offer as any]})).toBe(false)
    expect(priceEvidenceChanged(product,{...product,offers:[{...product.offers[0]!,price_cents:2600}]})).toBe(true)
    expect(priceEvidenceChanged(product,{...product,variant:'Paperback'})).toBe(true)
  })
})
