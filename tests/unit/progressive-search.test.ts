import { describe,expect,it } from 'vitest'
import { mergeResearch,researchTasks,isProductListing,titleMatches } from '../../server/utils/progressive-search'
import type { ProductDraft,SearchResult } from '../../shared/types'
const offer={retailer:'Shop',url:'https://shop.example/book',price_cents:1000,seller_type:'retailer' as const,us_shipping:'unknown' as const,availability:'unknown' as const,shipping_note:''}
const product:ProductDraft={name:'Book',variant:'Hardcover',category:'Books',notes:'',msrp_cents:null,msrp_source_url:null,offers:[]}
const result=(products:ProductDraft[]):SearchResult=>({summary:'Sourced',products,sources:[],warnings:[],retailer_checks:[],checked_at:'2026-10-30T12:00:00Z'})
describe('Incremental product research',()=>{
 it('rejects category/search offers and the caffeinated product when Nitric is requested',()=>{
  expect(isProductListing('https://www.newegg.com/p/pl?d=mouse')).toBe(false)
  expect(isProductListing('https://www.walmart.com/browse/electronics')).toBe(false)
  expect(isProductListing('https://www.amazon.com/dp/B0DVC217X9')).toBe(true)
  expect(titleMatches('Gorilla Mode Nitric','Gorilla Mode Pre-Workout Sour Gummy Worm')).toBe(false)
  expect(titleMatches('Razer DeathAdder V3','Razer DeathAdder V2')).toBe(false)
  expect(titleMatches('Gorilla Mode Nitric Stim-Free Pre-Workout','Gorilla Mode Nitric 808g')).toBe(true)
 })
 it('focuses pasted URLs on the listing first and skips redundant Amazon discovery',()=>{
  const tasks=researchTasks('https://www.amazon.com/dp/B0DVC217X9')
  expect(tasks[0]?.domains).toEqual(['www.amazon.com'])
  expect(tasks[0]?.focus).toContain('Do not run a broad comparison yet')
  expect(tasks.map(t=>t.id)).toEqual(['identify','manufacturer','retailers'])
 })
 it('publishes identity without waiting for stores and replaces pending warnings on completion',()=>{
  const initial=mergeResearch(result([product]),result([]),true)
  expect(initial.products[0]?.name).toBe('Book')
  expect(initial.warnings?.some(w=>w.includes('still running'))).toBe(true)
  const completed=mergeResearch(initial,result([{...product,offers:[offer]}]),false)
  expect(completed.products[0]?.offers).toEqual([offer])
  expect(completed.warnings?.some(w=>w.includes('still running'))).toBe(false)
  expect(completed.warnings?.some(w=>w.includes('1 of 2'))).toBe(true)
 })
 it('never mixes a different variant into an identified item',()=>{
  const completed=mergeResearch(result([product]),result([{...product,variant:'Paperback',offers:[offer]}]),false)
  expect(completed.products[0]?.offers).toEqual([])
 })
 it('keeps existing offers through a failed retailer stage',()=>{
  const completed=mergeResearch(result([{...product,offers:[offer]}]),{...result([]),warnings:['Amazon check could not finish.']},false)
  expect(completed.products[0]?.offers).toEqual([offer])
  expect(completed.warnings).toContain('Amazon check could not finish.')
 })
})
