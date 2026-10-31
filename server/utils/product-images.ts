import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
import { BlockList,isIP,type LookupFunction } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductDraft,WishItem } from '../../shared/types'
import { imageUrl,publicUrl } from '../../shared/validation'

const blocked4=new BlockList()
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked4.addSubnet(address,prefix,'ipv4')
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6')
const blocked6=new BlockList();blocked6.addSubnet('2001::',23,'ipv6');blocked6.addSubnet('2001:db8::',32,'ipv6');blocked6.addSubnet('2002::',16,'ipv6');blocked6.addSubnet('3fff::',20,'ipv6')
export function isPublicAddress(address:string) {
  return isIP(address)===4?!blocked4.check(address,'ipv4'):isIP(address)===6&&global6.check(address,'ipv6')&&!blocked6.check(address,'ipv6')
}
const safeLookup:LookupFunction=(hostname,options,callback)=>{
  void lookup(hostname,{all:true,verbatim:true}).then(addresses=>{
    if(!addresses.length||addresses.some(entry=>!isPublicAddress(entry.address)))throw new Error('Not a public host')
    // Pin the connection to the validated DNS answer; don't resolve the host again.
    if(options.all)callback(null,addresses)
    else callback(null,addresses[0]!.address,addresses[0]!.family)
  }).catch(error=>callback(error,'',4))
}
export async function fetchProductPage(value:string,signal:AbortSignal,redirects=0):Promise<{html:string;url:string}> {
  if(!publicUrl.safeParse(value).success||redirects>2)throw new Error('Invalid product page')
  const url=new URL(value)
  if(url.port&&url.port!=='443')throw new Error('Invalid HTTPS port')
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',agent:false,lookup:safeLookup,signal,headers:{'User-Agent':'Osk/1.0 (product image metadata)','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'}},response=>{
      if([301,302,303,307,308].includes(response.statusCode||0)&&response.headers.location){
        response.destroy()
        void fetchProductPage(new URL(response.headers.location,url).href,signal,redirects+1).then(resolve,reject);return
      }
      if(response.statusCode!==200||!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type']||'')||response.headers['content-encoding']){
        response.destroy();reject(new Error('No readable product page'));return
      }
      const chunks:Buffer[]=[];let bytes=0
      response.on('data',(chunk:Buffer)=>{
        const room=2*1024*1024-bytes
        chunks.push(chunk.subarray(0,room));bytes+=Math.min(room,chunk.length)
        if(bytes>=2*1024*1024){resolve({html:Buffer.concat(chunks).toString('utf8'),url:url.href});response.destroy()}
      })
      response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),url:url.href}))
      response.on('error',reject)
    })
    req.on('error',reject);req.end()
  })
}
function decode(value:string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,entity=>{
    const named:Record<string,string>={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}
    if(named[entity.toLowerCase()])return named[entity.toLowerCase()]!
    const n=entity.toLowerCase().startsWith('&#x')?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10)
    return n>0&&n<=0x10ffff?String.fromCodePoint(n):''
  })
}
function attributes(tag:string) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)].map(m=>[m[1]!.toLowerCase(),decode(m[2]??m[3]??m[4]??'')]))
}
function matches(name:string,title:string) {
  const ignored=new Set(['the','and','with','for','pre','workout','stim','free','stimulant','upgraded','best','tasting'])
  const words=name.toLowerCase().match(/[a-z0-9]+/g)||[]
  const actual=new Set(title.toLowerCase().match(/[a-z0-9]+/g)||[])
  const important=words.filter(w=>(w.length>=3||/\d/.test(w))&&!ignored.has(w))
  return important.length>0&&important.every(w=>actual.has(w))
}
export function extractProductImage(html:string,pageUrl:string,name:string):{image_url:string;image_source_url:string}|null {
  const meta=new Map<string,string>()
  for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const a=attributes(tag);const key=(a.property||a.name||'').toLowerCase();if(a.content&&!meta.has(key))meta.set(key,a.content)}
  const pageTitle=meta.get('og:title')||decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')
  const candidate=(value:unknown)=>{
    if(typeof value!=='string'||!value.trim())return null
    try{const url=new URL(decode(value),pageUrl).href;return imageUrl.safeParse(url).success?{image_url:url,image_source_url:pageUrl}:null}catch{return null}
  }
  if(matches(name,pageTitle)){
    for(const key of ['og:image:secure_url','og:image','og:image:url','twitter:image','twitter:image:src']){const found=candidate(meta.get(key));if(found)return found}
  }
  const productImages=(node:any,depth=0):ReturnType<typeof candidate>=>{
    if(!node||typeof node!=='object'||depth>8)return null
    if(Array.isArray(node)){for(const child of node.slice(0,50)){const found=productImages(child,depth+1);if(found)return found}return null}
    const types=Array.isArray(node['@type'])?node['@type']:[node['@type']]
    if(types.some((t:unknown)=>typeof t==='string'&&/(^|[\/#])Product$/.test(t))&&typeof node.name==='string'&&matches(name,node.name)){
      const images=Array.isArray(node.image)?node.image:[node.image]
      for(const image of images){const found=candidate(typeof image==='string'?image:image?.url||image?.contentUrl);if(found)return found}
    }
    for(const key of ['@graph','mainEntity','hasVariant']){const found=productImages(node[key],depth+1);if(found)return found}
    return null
  }
  for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(attributes(script[1]||'').type?.toLowerCase()!=='application/ld+json')continue
    try{const found=productImages(JSON.parse(script[2]!));if(found)return found}catch{/* Invalid publisher metadata: keep the fallback. */}
  }
  if(matches(name,pageTitle))for(const tag of html.match(/<img\b[^>]*>/gi)||[]){
    const a=attributes(tag)
    if(a.id!=='landingImage'&&a.itemprop!=='image')continue
    const high=candidate(a['data-old-hires']);if(high)return high
    if(a['data-a-dynamic-image'])try{
      const dynamic=JSON.parse(a['data-a-dynamic-image']) as Record<string,number[]>
      for(const [url] of Object.entries(dynamic).sort((a,b)=>(b[1][0]||0)*(b[1][1]||0)-(a[1][0]||0)*(a[1][1]||0))){const found=candidate(url);if(found)return found}
    }catch{/* Use the ordinary image src if available. */}
    const found=candidate(a.src);if(found)return found
  }
  return null
}
export async function resolveProductImage(product:ProductDraft,hints:string[]=[],reader=fetchProductPage):Promise<ProductDraft> {
  if(product.image_mode==='none'||product.image_mode==='custom'||product.image_url)return product
  const urls=[...new Set([...hints,product.msrp_source_url,...product.offers.filter(o=>o.seller_type==='manufacturer').map(o=>o.url),...product.offers.map(o=>o.url)])]
    .filter((url):url is string=>!!url&&publicUrl.safeParse(url).success).slice(0,3)
  const signal=AbortSignal.timeout(5500)
  // Try the preferred listing first; the entire lookup shares one short time budget.
  for(const url of urls){
    if(signal.aborted)break
    try{const page=await reader(url,signal);const image=extractProductImage(page.html,page.url,product.name);if(image)return {...product,...image,image_mode:'auto'}}catch{/* Blocked/slow stores do not fail price research. */}
  }
  return product
}
export async function fillItemPicture(db:SupabaseClient,id:string) {
  const {data:item,error}=await db.from('wish_items').select('*').eq('id',id).maybeSingle()
  if(error||!item||item.image_mode!=='auto'||item.image_url)return
  const found=await resolveProductImage(item as WishItem)
  if(!found.image_url)return
  const {error:saveError}=await db.from('wish_items').update({image_url:found.image_url,image_source_url:found.image_source_url})
    .eq('id',id).eq('name',item.name).eq('variant',item.variant).eq('image_mode','auto').is('image_url',null)
  if(saveError)throw new Error('Product picture could not be saved')
}
export async function dispatchItemPicture(db:SupabaseClient,id:string) {
  if(process.env.URL){
    if(!process.env.PRICE_REFRESH_SECRET)return
    const response=await fetch(new URL('/.netlify/functions/product-image-background',process.env.URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.PRICE_REFRESH_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({id}),signal:AbortSignal.timeout(3000)})
    if(!response.ok)throw new Error('Picture dispatch failed');return
  }
  if(process.env.NETLIFY||process.env.NODE_ENV==='production')return
  void fillItemPicture(db,id).catch(()=>console.warn('Product picture lookup unavailable',{id}))
}
