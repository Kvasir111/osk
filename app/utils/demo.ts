import type { WishItem, WishList } from '../../shared/types'
const created = '2026-10-30T12:00:00.000Z'
const listId = 'demo-christmas'
export function demoData(): { lists: WishList[]; items: WishItem[] } {
  return {
    lists: [
      { id: listId, owner_id: 'demo', name: 'Christmas wishes', description: 'A few things I’d love to unwrap. For our family Secret Santa ✨', occasion: 'christmas', created_at: created, share_token: null },
      { id: 'demo-everyday', owner_id: 'demo', name: 'Someday, maybe', description: 'Good finds for another day.', occasion: 'everyday', created_at: created, share_token: null },
    ],
    items: [
      { id: 'demo-mouse', list_id: listId, name: 'Razer DeathAdder V3', variant: 'Wired · Black', category: 'Tech', notes: 'The lightweight wired version, please.', msrp_cents: 6999, msrp_source_url: 'https://www.razer.com/gaming-mice/razer-deathadder-v3', offers: [{ retailer: 'Razer', url: 'https://www.razer.com/gaming-mice/razer-deathadder-v3', price_cents: 4999, seller_type: 'manufacturer', us_shipping: 'confirmed', availability: 'in_stock', shipping_note: 'Sample offer — not a live price.' }] },
      { id: 'demo-headphones', list_id: listId, name: 'QuietComfort Headphones', variant: 'Bose · Cypress Green', category: 'Tech', notes: 'For long flights and focused afternoons.', msrp_cents: 34900, msrp_source_url: 'https://www.bose.com', offers: [{ retailer: 'Bose', url: 'https://www.bose.com', price_cents: 24900, seller_type: 'manufacturer', us_shipping: 'unknown', availability: 'unknown', shipping_note: 'Sample offer — not a live price.' }] },
      { id: 'demo-coffee', list_id: listId, name: 'Stagg EKG Electric Kettle', variant: 'Fellow · Matte Black', category: 'Home', notes: 'A little upgrade for my morning ritual.', msrp_cents: 16500, msrp_source_url: 'https://fellowproducts.com', offers: [{ retailer: 'Fellow', url: 'https://fellowproducts.com', price_cents: 16500, seller_type: 'manufacturer', us_shipping: 'unknown', availability: 'unknown', shipping_note: 'Sample offer — not a live price.' }] },
    ].map(item => ({ ...item, created_at: created, checked_at: null, last_attempt_at: null, refresh_status: 'never' } as WishItem)),
  }
}
