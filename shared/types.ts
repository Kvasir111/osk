export interface Offer {
  retailer: string
  url: string
  price_cents: number
  seller_type: 'manufacturer' | 'retailer' | 'marketplace'
  us_shipping: 'confirmed' | 'unknown'
  availability: 'in_stock' | 'unknown'
  shipping_note: string
}
export interface ProductDraft {
  image_url?: string | null
  image_source_url?: string | null
  image_mode?: 'auto' | 'custom' | 'none'
  name: string
  variant: string
  category: string
  msrp_cents: number | null
  msrp_source_url: string | null
  offers: Offer[]
  notes: string
}
export interface WishItem extends ProductDraft {
  id: string
  list_id: string
  created_at: string
  checked_at: string | null
  refresh_status: 'never' | 'ok' | 'failed'
  last_attempt_at: string | null
  price_check_details?: PriceCheckDetails
}
export interface WishList {
  id: string
  owner_id: string
  name: string
  description: string
  occasion: 'everyday' | 'christmas' | 'birthday' | 'other'
  created_at: string
  share_token: string | null
}
export interface SearchResult {
  summary: string
  products: ProductDraft[]
  sources: { title: string; url: string }[]
  checked_at: string
  retailer_checks?: {
    retailer: string
    url: string | null
    note: string
  }[]
  warnings?: string[]
}

export interface PriceCheckDetails {
  warnings: string[]
  retailer_checks: { retailer: string; url: string | null; note: string }[]
}
export interface PriceObservation {
  id: string
  item_id: string
  name: string
  variant: string
  observed_at: string
  source: 'search' | 'manual'
  offers: Offer[]
  msrp_cents: number | null
}
export interface Family {
  id: string
  owner_id: string
  name: string
  created_at: string
}
export interface FamilyMember {
  user_id: string
  display_name: string
  avatar_url: string | null
}
export interface FamilyDetail {
  family: Family
  members: FamilyMember[]
  links: { list_id: string }[]
}

export interface SearchStage {
  id: string
  label: string
  status: 'waiting' | 'running' | 'completed' | 'failed'
}
export interface ProductSearchJob {
  id: string
  user_id: string
  query: string
  product_url: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  stages: SearchStage[]
  result: SearchResult | null
  error_message: string | null
  approved_item_id: string | null
  approved_snapshot: WishItem | null
  created_at: string
  updated_at: string
  finished_at: string | null
}
