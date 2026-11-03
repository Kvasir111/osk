// Parse publisher-owned JSON only. Never execute storefront JavaScript or fetch extra endpoints.
type Node = Record<string, any>
const array = (value: unknown): any[] => Array.isArray(value) ? value.slice(0, 100) : []
export function storeProductNodes(html: string, pageUrl: string, meta: Map<string, string>, readAttributes: (tag: string) => Record<string, string>) {
  const page = new URL(pageUrl), nodes: Node[] = []
  const base = new URL(pageUrl); base.search = ''; base.hash = ''
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = readAttributes(script[1] || '')
    let data: Node
    try { data = JSON.parse(script[2]!) } catch { continue }
    if (!data || typeof data !== 'object') continue
    if (/^(?:www\.)?511tactical\.com$/.test(page.hostname) && attrs.type === 'text/x-magento-init') {
      const configs = Object.values(data).flatMap(value => value && typeof value === 'object' ? [value['Magento_Swatches/js/swatch-renderer']?.jsonConfig] : []).filter(Boolean)
      for (const config of configs) {
        if (!config.index || !config.attributes || !config.optionPrices || !meta.get('og:title')) continue
        const variants = Object.entries(config.index).slice(0, 100).flatMap(([id, selected]) => {
          if (!selected || typeof selected !== 'object') return []
          const url = new URL(base), labels: Record<string, string> = {}
          for (const [attributeId, optionId] of Object.entries(selected)) {
            const attribute = config.attributes[attributeId]
            if (!attribute || !['color', 'size'].includes(attribute.code)) return []
            const option = array(attribute.options).find(option => String(option.id) === String(optionId) && array(option.products).some(product => String(product) === id))
            if (!option || typeof option.label !== 'string') return []
            url.searchParams.set(attribute.code, String(optionId)); labels[attribute.code] = option.label
          }
          if (Object.keys(labels).length !== Object.keys(config.attributes).length) return []
          const amount = config.optionPrices[id]?.finalPrice?.amount
          const price = config.optionPrices[id]
          const vip = [true, 1, '1'].includes(config.is_vip)
          // The page exposes a global VIP flag even for unchanged public prices.
          // Never import a member discount; require agreement with both regular amounts.
          const memberPrice = vip && !(typeof amount === 'number' && amount === price?.basePrice?.amount && amount === price?.oldPrice?.amount)
          // "$" alone is ambiguous; require the page's explicit ISO currency.
          const currency = meta.get('product:price:currency')
          return [{ '@type': 'Product', name: meta.get('og:title'), ...labels, url: url.href,
            image: array(config.images?.[id]).find(image => image?.isMain)?.img,
            offers: memberPrice || array(price?.tierPrices).length ? [] : { '@type': 'Offer', price: amount, priceCurrency: currency,
              description: vip ? 'Store exposes VIP-program metadata; no member discount was inferred. Confirm eligibility at checkout.' : '' } }]
        })
        if (variants.length) nodes.push({ '@type': 'ProductGroup', name: meta.get('og:title'), url: base.href, hasVariant: variants })
      }
    }
    if (attrs.type !== 'application/json' || !/product/i.test(attrs.id || '') && !Object.hasOwn(attrs, 'data-product-json')) continue
    const product = data.product || data
    if (typeof product.title !== 'string' || !Array.isArray(product.variants) || typeof product.handle !== 'string' || !base.pathname.endsWith('/products/' + product.handle)) continue
    const currency = product.currency || meta.get('product:price:currency')
    const variants = array(product.variants).flatMap(variant => {
      if (!variant || !/^\d+$/.test(String(variant.id)) || typeof variant.title !== 'string') return []
      const url = new URL(base); url.searchParams.set('variant', String(variant.id))
      const cents = typeof variant.price === 'number' && Number.isSafeInteger(variant.price) && variant.price > 0 ? variant.price : null
      return [{ '@type': 'Product', name: product.title, model: variant.title === 'Default Title' ? '' : variant.title, sku: variant.sku, url: url.href,
        image: variant.featured_image?.src,
        offers: { '@type': 'Offer', price: cents === null ? undefined : (cents / 100).toFixed(2), priceCurrency: currency,
          availability: variant.available === true ? 'https://schema.org/InStock' : variant.available === false ? 'https://schema.org/OutOfStock' : undefined,
          validForMemberTier: product.requires_selling_plan || variant.requires_selling_plan ? 'Subscription required' : undefined } }]
    })
    if (variants.length) nodes.push({ '@type': 'ProductGroup', name: product.title, url: base.href, hasVariant: variants })
  }
  return nodes
}
