import type { Offer, ProductDraft, SearchResult, WishItem } from '../../shared/types'
import { imageUrl, productSchema, publicUrl } from '../../shared/validation'
import { captureUrl } from '../../shared/capture'
import { attributes, decode, extractProductImage, fetchProductPage } from './product-images'

type Node = Record<string, any>
const text = (value: unknown, limit = 200) => typeof value === 'string' ? decode(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const list = (value: unknown): any[] => Array.isArray(value) ? value : value ? [value] : []
const typeIs = (node: Node, type: string) => list(node['@type']).some(value => typeof value === 'string' && value.split(/[\/#]/).pop() === type)
function link(value: unknown, base: string) {
  if (typeof value !== 'string' || !value.trim()) return null
  try { const url = new URL(decode(value), base).href; return publicUrl.safeParse(url).success ? url : null } catch { return null }
}
function sameListing(a: string, b: string) {
  const first = new URL(a), second = new URL(b)
  first.hash = ''; second.hash = ''
  for (const url of [first, second]) for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|tag$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
  // Rogue's group links use uppercase SKUs; its selected-page canonical metadata lowercases them.
  for (const url of [first, second]) if (/^(?:www\.)?roguefitness\.com$/.test(url.hostname) && url.searchParams.has('sku')) url.searchParams.set('sku', url.searchParams.get('sku')!.toLowerCase())
  first.searchParams.sort(); second.searchParams.sort()
  return first.href.replace(/\/$/, '') === second.href.replace(/\/$/, '')
}
function samePage(a: string, b: string) {
  const first = new URL(a), second = new URL(b)
  return first.origin === second.origin && first.pathname.replace(/\/$/, '') === second.pathname.replace(/\/$/, '')
}
export function priceCents(value: unknown): number | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? cents : null
}
function identityMatches(expected: ProductDraft, name: string, variant: string) {
  const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) || []
  const actual = new Set(tokens(`${name} ${variant}`))
  const required = tokens(`${expected.name} ${expected.variant}`).filter(word => !['the', 'and', 'with', 'for'].includes(word))
  return required.length > 0 && required.every(word => actual.has(word))
}

export function parseProductPage(html: string, pageUrl: string, expected?: ProductDraft): { product: ProductDraft; warnings: string[]; variants?: SearchResult['variants'] } {
  const page = new URL(pageUrl)
  if (/\/(?:search|browse|categories|category|collections)(?:\/|$)/i.test(page.pathname)) throw new Error('Use an individual product page.')
  const meta = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = attributes(tag), key = (attr.property || attr.name || '').toLowerCase()
    if (attr.content && !meta.has(key)) meta.set(key, attr.content)
  }
  const products: Node[] = []
  const groups: Node[] = []
  let visited = 0
  function walk(node: unknown, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 8 || ++visited > 200) return
    if (Array.isArray(node)) { for (const child of node.slice(0, 50)) walk(child, depth + 1); return }
    const value = node as Node
    if (typeIs(value, 'Product') && !typeIs(value, 'ProductGroup')) products.push(value)
    if (typeIs(value, 'ProductGroup')) groups.push(value)
    for (const key of ['@graph', 'mainEntity', 'hasVariant']) walk(value[key], depth + 1)
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(script[1] || '').type?.toLowerCase() !== 'application/ld+json') continue
    try { walk(JSON.parse(script[2]!)) } catch { /* Malformed publisher metadata is optional. */ }
  }
  const exact = products.filter(product => {
    const url = link(product.url || product['@id'], pageUrl)
    return url && sameListing(url, pageUrl)
  })
  const matchingGroups = groups.filter(group => {
    const url = link(group.url || group['@id'], pageUrl)
    return url && samePage(url, pageUrl)
  })
  const group = matchingGroups.length === 1 ? matchingGroups[0]! : null
  if (products.length > 1 && exact.length !== 1 && !group) throw new Error('The page contains multiple products or variants. Enter the selected variant manually.')
  // A group is a template, not an exact purchasable configuration. Never import its price or default color.
  const grouped = !!group && exact.length !== 1
  const node = exact.length === 1 ? exact[0]! : grouped ? group : products.length === 1 ? products[0]! : null
  const variants: NonNullable<SearchResult['variants']> = []
  if (group) for (const child of list(group.hasVariant).slice(0, 50)) {
    if (!child || typeof child !== 'object' || !typeIs(child, 'Product')) continue
    const url = link(child.url || child['@id'], pageUrl)
    if (!url || !samePage(url, pageUrl) || variants.some(option => sameListing(option.url, url))) continue
    const label = [...new Set([text(child.name), text(child.color), text(typeof child.size === 'string' ? child.size : child.size?.name), text(child.sku)].filter(Boolean))].join(' · ').slice(0, 400)
    if (label) variants.push({ label, url })
  }
  const pageTitle = text(meta.get('og:title') || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  if (!node && meta.get('og:type') !== 'product') throw new Error('No unambiguous product metadata was found. Enter the details manually.')
  const name = text(node?.name) || pageTitle
  if (!name || /captcha|access denied|just a moment|robot check/i.test(name)) throw new Error('This store blocked the listing. Enter details manually.')
  const variant = node && !grouped ? [...new Set([text(node.color), text(typeof node.size === 'string' ? node.size : node.size?.name), text(node.model)].filter(Boolean))].join(' · ').slice(0, 200) : ''
  if (expected && !identityMatches(expected, name, variant)) throw new Error('The page did not confirm the saved product and variant.')
  const declared = node && link(node.url || node['@id'], pageUrl)
  if (declared && (new URL(declared).origin !== page.origin || new URL(declared).pathname.replace(/\/$/,'') !== page.pathname.replace(/\/$/,''))) throw new Error('The metadata describes another product page.')
  const selectedVariant = !grouped && (!page.search || !!declared && sameListing(declared, pageUrl))
  const warnings: string[] = []
  if (grouped) warnings.push('This page describes multiple options or configurations. Choose an exact option to read its price, or save the general item without a price. Further customization may change the total.')
  else if (!selectedVariant) warnings.push('The selected URL variant was not confirmed in the page metadata. No price was imported.')
  let offers = list(node?.offers).filter(value => value && typeof value === 'object' && !typeIs(value, 'AggregateOffer')) as Node[]
  const exactOffers = offers.filter(offer => { const url = link(offer.url, pageUrl); return url && sameListing(url, pageUrl) })
  if (exactOffers.length) offers = exactOffers
  // Multiple variant/seller prices and aggregate ranges are not one exact listing price.
  let offer: Node | null = offers.length === 1 ? offers[0]! : null
  if (!node && selectedVariant) offer = { price: meta.get('product:price:amount') || meta.get('og:price:amount'), priceCurrency: meta.get('product:price:currency') || meta.get('og:price:currency') }
  const seller = text(offer?.seller?.name || offer?.seller)
  const marketplace = /(^|\.)(amazon\.com|ebay\.com|etsy\.com|walmart\.com)$/.test(page.hostname)
  const manufacturerUrl = link(node?.manufacturer?.url, pageUrl)
  const manufacturer = !!manufacturerUrl && new URL(manufacturerUrl).hostname === page.hostname && !marketplace
  const currency = offer?.priceCurrency
  const cents = priceCents(offer?.price)
  const offerUrl = link(offer?.url, pageUrl)
  const availability = text(offer?.availability)
  const condition = text(offer?.itemCondition)
  const validUntil = typeof offer?.priceValidUntil === 'string' ? Date.parse(offer.priceValidUntil) : NaN
  const conditional = offer && (offer.validForMemberTier || offer.eligibleQuantity || offer.eligibleTransactionVolume || /subscription|membership|subscribe/i.test(text(offer.name)) || list(offer.priceSpecification).some(spec => spec?.billingDuration || spec?.billingIncrement || spec?.validForMemberTier))
  const ordinary = !conditional && !/outofstock|soldout|discontinued/i.test(availability) && (!condition || /(?:^|\/)NewCondition$/.test(condition)) && !(validUntil < Date.now())
  const priced: Offer[] = []
  if (selectedVariant && (!offerUrl || sameListing(offerUrl, pageUrl)) && cents !== null && currency === 'USD' && ordinary && (!marketplace || seller && !/unknown|unverified|not specified/i.test(seller))) {
    priced.push({ retailer: page.hostname.replace(/^www\./, '').slice(0,100), url: pageUrl, price_cents: cents,
      seller_type: marketplace ? 'marketplace' : manufacturer ? 'manufacturer' : 'retailer', us_shipping: 'unknown',
      availability: /(?:^|\/)InStock$/.test(availability) ? 'in_stock' : 'unknown',
      shipping_note: `${seller ? `Seller: ${seller}. ` : ''}Page metadata; tax, shipping, and checkout conditions unverified.` })
  }
  if (!priced.length) warnings.push('No exact, current one-time USD price could be verified from this page. You can still save the product or enter a price manually.')
  let msrp: number | null = null
  if (selectedVariant && manufacturer && offer) for (const specification of list(offer.priceSpecification)) {
    if (specification && /(?:^|\/)MSRP$/i.test(String(specification.priceType)) && specification.priceCurrency === 'USD') msrp = priceCents(specification.price)
  }
  // Use the selected node's image before generic OG/JSON-LD fallback, which may show a different option.
  const ownImage = list(node?.image).map(value => link(typeof value === 'string' ? value : value?.url || value?.contentUrl, pageUrl)).find(value => value && imageUrl.safeParse(value).success)
  const image = ownImage ? { image_url: ownImage, image_source_url: pageUrl } : group && !grouped ? null : extractProductImage(html, pageUrl, name)
  const product = productSchema.parse({ name: expected?.name || name, variant: expected?.variant ?? variant, category: expected?.category || 'Other',
    notes: expected?.notes || (pageUrl.length <= 1980 ? `Product link: ${pageUrl}` : ''), offers: priced, msrp_cents: msrp, msrp_source_url: msrp ? pageUrl : null,
    image_mode: 'auto', image_url: image?.image_url || null, image_source_url: image?.image_source_url || null })
  return { product, warnings, ...(variants.length ? { variants } : {}) }
}

export function savedProductUrls(item: WishItem) {
  const notes = (item.notes.match(/https:\/\/[^\s<>"']+/g) || []).map(value => captureUrl(value))
  return [...new Set([...item.offers.map(offer => offer.url), ...(item.price_check_details?.retailer_checks || []).map(check => check.url), item.msrp_source_url, ...notes])]
    .filter((url): url is string => !!url && publicUrl.safeParse(url).success).slice(0, 10)
}

export async function scrapeProducts(urls: string[], expected?: ProductDraft, reader = fetchProductPage): Promise<SearchResult> {
  const unique = [...new Set(urls)].filter(url => publicUrl.safeParse(url).success).slice(0, 10)
  if (!unique.length) throw new Error('Paste a public HTTPS product link, or add the item manually.')
  const signal = AbortSignal.timeout(8000)
  const findings: ReturnType<typeof parseProductPage>[] = []
  const checks: NonNullable<SearchResult['retailer_checks']> = []
  const sources: SearchResult['sources'] = []
  // Bound concurrent store requests and the entire lookup; never crawl linked pages.
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
    for (;;) {
      const url = unique[cursor++]
      if (!url) return
      try {
        const page = await reader(url, signal)
        // A redirect to a different product must not silently change what is being tracked.
        if (expected && !sameListing(url, page.url)) throw new Error('The saved listing redirected to another URL.')
        const result = parseProductPage(page.html, page.url, expected)
        findings.push(result); sources.push({ title: result.product.name, url: page.url })
        if (!result.product.offers.length) checks.push({ retailer: new URL(url).hostname, url, note: result.warnings.join(' ').slice(0,600) })
      } catch { checks.push({ retailer: new URL(url).hostname, url, note: 'The listing was blocked, unavailable, or did not establish the exact product and price. Enter details manually if needed.' }) }
    }
  }))
  const base = findings[0]?.product
  const products = base ? [{ ...base, offers: findings.flatMap(result => result.product.offers).slice(0,10),
    msrp_cents: findings.find(result => result.product.msrp_cents)?.product.msrp_cents ?? null,
    msrp_source_url: findings.find(result => result.product.msrp_cents)?.product.msrp_source_url ?? null }] : []
  return { summary: products.length ? 'Details read from the product page. Review the exact item and price before saving.' : 'This store did not provide readable product details. You can enter the wish manually.',
    products, sources, checked_at: new Date().toISOString(), retailer_checks: checks,
    ...(findings[0]?.variants?.length ? { variants: findings[0].variants } : {}),
    warnings: [...new Set(findings.flatMap(result => result.warnings).concat(checks.length ? ['Some saved listings could not be verified. Previous prices are kept when a check fails.'] : []))] }
}
