import { z } from 'zod'
export const publicUrl = z.string().max(2048).url().refine(value => {
  let url: URL
  try { url = new URL(value) } catch { return false }
  return url.protocol === 'https:' && !url.username && !url.password &&
    !url.hostname.endsWith('.local') && !url.hostname.endsWith('.localhost') &&
    url.hostname !== 'localhost' && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':')
}, 'Use a public HTTPS product URL')
export const imageUrl = publicUrl.refine(value => !/\.svgz?(?:$|[?#])/i.test(value), 'Use a product photo URL, such as JPG, PNG, WebP, or AVIF')
export const offerSchema = z.object({
  retailer: z.string().trim().min(1).max(100), url: publicUrl,
  price_cents: z.number().int().positive().max(100000000),
  seller_type: z.enum(['manufacturer', 'retailer', 'marketplace']),
  us_shipping: z.enum(['confirmed', 'unknown']),
  availability: z.enum(['in_stock', 'unknown']), shipping_note: z.string().max(500),
})
export const wishDetailsSchema = z.object({
  priority: z.enum(['idea', 'really_want']).optional(),
  gift_preferences: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'received', 'archived']).optional(),
})
export const transferSchema = z.object({
  target: z.string().uuid(), mode: z.enum(['move', 'copy']),
  items: z.array(z.object({ id: z.string().uuid(), copy_id: z.string().uuid() })).min(1).max(50),
}).refine(input => new Set(input.items.map(i => i.id)).size === input.items.length && new Set(input.items.map(i => i.copy_id)).size === input.items.length, 'Select each wish once')
export const productSchema = z.object({
  ...wishDetailsSchema.shape,
  image_url: imageUrl.nullable().optional(), image_source_url: publicUrl.nullable().optional(),
  image_mode: z.enum(['auto','custom','none']).optional(),
  name: z.string().trim().min(1).max(200), variant: z.string().max(200),
  category: z.string().max(50),
  msrp_cents: z.number().int().positive().max(100000000).nullable(),
  msrp_source_url: publicUrl.nullable(), offers: z.array(offerSchema).max(10),
  notes: z.string().max(2000),
}).refine(p => p.msrp_cents === null || p.msrp_source_url !== null, {
  message: 'An MSRP needs a source URL', path: ['msrp_source_url'],
}).refine(p => p.image_mode !== 'custom' || !!p.image_url, { message: 'Add an image link or choose automatic/category artwork', path: ['image_url'] })
export const listSchema = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).default(''),
  occasion: z.enum(['everyday', 'christmas', 'birthday', 'other']).default('everyday'),
})

export const priceCheckSchema = z.object({
  warnings: z.array(z.string().max(1000)).max(12).default([]),
  retailer_checks: z.array(z.object({ retailer: z.string().max(100), url: publicUrl.nullable(), note: z.string().max(600) })).max(10).default([]),
})
