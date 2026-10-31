import type { ProductDraft } from './types'
import { imageUrl } from './validation'
export function pictureUrl(product: Pick<ProductDraft,'image_url'|'image_mode'>) {
  return product.image_mode !== 'none' && product.image_url && imageUrl.safeParse(product.image_url).success ? product.image_url : null
}
export function normalizePicture<T extends ProductDraft>(product:T):T {
  if(product.image_mode==='none')return {...product,image_url:null,image_source_url:null}
  if(product.image_mode==='custom')return {...product,image_source_url:null}
  return product
}
export function artworkFor(name:string) {
  return /mouse|deathadder/i.test(name)?'mouse':/headphone|quietcomfort/i.test(name)?'headphones':/kettle|stagg/i.test(name)?'kettle':'box'
}
