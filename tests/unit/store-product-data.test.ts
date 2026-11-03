import { describe, expect, it } from 'vitest'
import { parseProductPage, savedProductUrls } from '../../server/utils/product-scraper'
import { repairProduct } from '../../shared/tracking'
import type { WishItem, ProductDraft } from '../../shared/types'
const shop='https://shop.example.com/products/drink'
const shopify={title:'Test Drink',handle:'drink',variants:[{id:123,title:'Lime / 40 servings',price:4500,available:true},{id:456,title:'Berry / 40 servings',price:4600,available:true}]}
const page=(data:unknown,currency='USD')=>`<meta property="og:type" content="product"><meta property="product:price:currency" content="${currency}"><script type="application/json" id="ProductJson-main">${JSON.stringify(data)}</script>`
describe('Publisher variant data',()=>{
 it('reads Shopify cents and exact option IDs without taking the lowest/default price or compare-at MSRP',()=>{
  const data={...shopify,compare_at_price:6000}
  const group=parseProductPage(page(data),shop)
  expect(group.product.offers).toEqual([]);expect(group.variants).toHaveLength(2)
  const found=parseProductPage(page(data),shop+'?variant=456').product
  expect(found).toMatchObject({name:'Test Drink',variant:'Berry / 40 servings',msrp_cents:null,offers:[{price_cents:4600}]})
  expect(parseProductPage(page(data),shop+'?variant=999').product.offers).toEqual([])
  expect(parseProductPage(page(data,'CAD'),shop+'?variant=456').product.offers).toEqual([])
  expect(parseProductPage(page({...data,requires_selling_plan:true}),shop+'?variant=456').product.offers).toEqual([])
  expect(parseProductPage(page({...data,variants:[{...data.variants[0],available:false}]}),shop+'?variant=123').product.offers).toEqual([])
  expect(()=>parseProductPage(page(data),shop+'?variant=456',{...found,variant:'Lime / 40 servings'})).toThrow('variant')
 })
 it('reads 5.11 Magento option labels/prices from pure JSON, preserving all selected attributes',()=>{
  const url='https://www.511tactical.com/vest.html'
  const config={attributes:{'92':{code:'color',options:[{id:'78',label:'Black (019)',products:['1']},{id:'803263',label:'Tank Green (837)',products:['2']}]},'179':{code:'size',options:[{id:'244',label:'1 SZ',products:['1','2']}]}},index:{'1':{'92':'78','179':'244'},'2':{'92':'803263','179':'244'}},optionPrices:{'1':{finalPrice:{amount:170}},'2':{finalPrice:{amount:175}}}}
  const html=`<meta property="og:title" content="Taconic Weight Vest"><meta property="product:price:currency" content="USD"><script type="text/x-magento-init">${JSON.stringify({'[data-role=swatch-options]':{'Magento_Swatches/js/swatch-renderer':{jsonConfig:config}}})}</script>`
  const group=parseProductPage(html,url)
  expect(group.product.offers).toEqual([]);expect(group.variants).toHaveLength(2)
  expect(group.variants?.[1]?.url).toBe(url+'?color=803263&size=244')
  expect(parseProductPage(html,url+'?color=803263&size=244').product).toMatchObject({variant:'Tank Green (837) · 1 SZ',offers:[{price_cents:17500}]})
  expect(parseProductPage(html,url+'?color=803263').product.offers).toEqual([])
  const vip=html.replace('"finalPrice":{"amount":175}', '"finalPrice":{"amount":175},"basePrice":{"amount":175},"oldPrice":{"amount":175}').replace('"index":', '"is_vip":true,"index":')
  expect(parseProductPage(vip,url+'?color=803263&size=244').product.offers[0]?.shipping_note).toContain('VIP-program')
  expect(parseProductPage(vip.replace('"basePrice":{"amount":175}', '"basePrice":{"amount":190}'),url+'?color=803263&size=244').product.offers).toEqual([])
  expect(()=>parseProductPage(html,'https://unrelated.example.com/vest.html')).toThrow()
 })
})
describe('Tracking corrections',()=>{
 const old='https://shop.example.com/products/drink?variant=123',selected='https://shop.example.com/products/drink?variant=456'
 const item={id:'item',name:'Test Drink',variant:'Lime / 40 servings',category:'Other',notes:`A personal note\nProduct link: ${old}\nI found it at ${old}`,offers:[{url:old,price_cents:4500}],msrp_cents:6000,msrp_source_url:'https://manufacturer.example.com/drink',image_mode:'custom',image_url:'https://images.example.com/custom.jpg',image_source_url:null,refresh_status:'failed',price_check_details:{warnings:[],retailer_checks:[{url:old,retailer:'Shop',note:'Wrong variant'}]}} as WishItem
 const detected={name:'Test Drink',variant:'Berry / 40 servings',category:'Other',notes:'',offers:[{url:selected,price_cents:4600}],msrp_cents:null,msrp_source_url:null} as ProductDraft
 it('requires an explicit correction draft and preserves notes/custom images without carrying old-variant offers or MSRP',()=>{
  const fixed=repairProduct(item,detected,old,selected)
  expect(fixed).toMatchObject({variant:detected.variant,offers:detected.offers,msrp_cents:null,image_url:item.image_url,image_mode:'custom'})
  expect(fixed.notes).toContain('A personal note');expect(fixed.notes).toContain(selected);expect(fixed.notes).not.toContain(old)
  expect(fixed.notes).toContain(`I found it at ${selected}`)
  const saved={...item,...fixed,refresh_status:'never'} as WishItem
  expect(savedProductUrls(saved)).not.toContain(old)
  expect(savedProductUrls(saved)).toContain(selected)
  expect(item.variant).toBe('Lime / 40 servings')
 })
 it('keeps other store offers when the identity is unchanged, leaving offer-count validation to the form',()=>{
  const previous={...item,offers:Array.from({length:10},(_,index)=>({...item.offers[0]!,url:`https://shop${index}.example.com/drink`}))}
  const same={...detected,name:item.name,variant:item.variant}
  const fixed=repairProduct(previous,same,old,selected)
  expect(fixed.offers).toHaveLength(11)
  expect(fixed.offers.slice(0,10)).toEqual(previous.offers)
  expect(fixed.msrp_cents).toBe(item.msrp_cents)
 })
})
