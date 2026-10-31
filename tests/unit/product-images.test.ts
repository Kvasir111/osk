import {describe,expect,it,vi} from 'vitest'
import {extractProductImage,isPublicAddress,resolveProductImage,fetchProductPage} from '../../server/utils/product-images'
import {pictureUrl,normalizePicture} from '../../shared/product-images'
import {productSchema} from '../../shared/validation'
import type {ProductDraft} from '../../shared/types'
const product:ProductDraft={name:'Gorilla Mode Nitric',variant:'Sour Gummy Worm',category:'Other',notes:'',msrp_cents:null,msrp_source_url:null,offers:[]}
const page='https://shop.example.com/products/nitric'
describe('Sourced product pictures',()=>{
 it('reads Open Graph metadata regardless of attribute order and decodes relative URLs',()=>{
  const html=`<meta content='Gorilla Mode Nitric' property='og:title'><meta content="/nitric.jpg?width=600&amp;height=500" property="og:image">`
  expect(extractProductImage(html,page,product.name)).toEqual({image_url:'https://shop.example.com/nitric.jpg?width=600&height=500',image_source_url:page})
 })
 it('finds a matching JSON-LD Product inside a graph without selecting a logo or another product',()=>{
  const html=`<script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'Organization',image:'https://cdn.example.com/logo.png'},{'@type':'Product',name:'Gorilla Mode',image:'https://cdn.example.com/wrong.jpg'},{'@type':'Product',name:'Gorilla Mode Nitric Sour Gummy Worm',image:{'@type':'ImageObject',contentUrl:'https://cdn.example.com/nitric.webp'}}]})}</script>`
  expect(extractProductImage(html,page,product.name)?.image_url).toBe('https://cdn.example.com/nitric.webp')
 })
 it('uses Amazon’s actual selected landing image when publisher metadata is missing',()=>{
  expect(extractProductImage('<title>Gorilla Mode Nitric Sour Gummy Worm</title><img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/real.jpg" src="https://cdn.example.com/small.jpg">',page,product.name)?.image_url).toContain('/real.jpg')
 })
 it('rejects unrelated titles, unsafe URLs, and malformed metadata',()=>{
  for(const html of ['<title>Different product</title><meta property="og:image" content="https://cdn.example.com/p.jpg">','<title>Gorilla Mode Nitric</title><meta property="og:image" content="javascript:alert(1)">','<script type="application/ld+json">{broken</script>'])expect(extractProductImage(html,page,product.name)).toBeNull()
  expect(pictureUrl({...product,image_url:'javascript:alert(1)'})).toBeNull()
 })
 it('blocks private, reserved, and IPv4-mapped DNS destinations',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::','not-an-ip'])expect(isPublicAddress(ip),ip).toBe(false)
  for(const ip of ['1.1.1.1','8.8.8.8','2001:4860:4860::8888','2606:4700:4700::1111'])expect(isPublicAddress(ip),ip).toBe(true)
 })
 it('does not fetch non-public URLs or custom/nonstandard service ports',async()=>{
  await expect(fetchProductPage('https://localhost/private',AbortSignal.timeout(50))).rejects.toThrow()
  await expect(fetchProductPage('https://example.com:8443/private',AbortSignal.timeout(50))).rejects.toThrow()
 })
 it('keeps category fallback on inaccessible pages without failing product research',async()=>{
  const reader=vi.fn().mockRejectedValue(new Error('Blocked'))
  expect(await resolveProductImage(product,[page],reader)).toEqual(product)
 })
 it('honors custom/category-only preferences without making metadata requests',async()=>{
  const reader=vi.fn()
  for(const image_mode of ['custom','none'] as const){const selected={...product,image_mode,image_url:'https://cdn.example.com/custom.jpg'};expect(await resolveProductImage(selected,[page],reader)).toEqual(selected)}
  expect(reader).not.toHaveBeenCalled()
  expect(normalizePicture({...product,image_mode:'none',image_url:'https://cdn.example.com/custom.jpg'}).image_url).toBeNull()
  expect(productSchema.safeParse({...product,image_mode:'custom',image_url:null}).success).toBe(false)
 })
})
