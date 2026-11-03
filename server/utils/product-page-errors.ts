// Only these fixed messages may be shown to users. Never expose arbitrary network/provider errors.
const messages = {
  invalid: 'Use an individual public HTTPS product link.',
  no_links: 'No public HTTPS store links are saved. Use Edit item → Add a store to provide a product link for price checks.',
  blocked: 'The store blocked automated access (HTTP 401/403 or a bot-check page). Keep the price manual or try another store link.',
  unavailable: 'The product page was not found or is no longer available. Update its store link in Edit item.',
  response: 'The store did not return readable product HTML. Its price cannot be checked automatically right now.',
  ambiguous: 'The page contains multiple products or variants. Save a link for the exact option instead.',
  metadata: 'No unambiguous product metadata was found. This store may need JavaScript; use a manual price or another store link.',
  identity: 'The page did not confirm the saved product name and variant. Check the name, color, size, and SKU in Edit item against this store link.',
  redirected: 'The saved link redirected to another listing or configuration. Review and update its URL in Edit item.',
  timeout: 'The store did not respond within the lookup time limit. Try again later or use another store link.',
  connection: 'The store could not be reached safely. Try again later or use another public HTTPS store link.',
} as const

export class ProductPageError extends Error {
  constructor(readonly reason: keyof typeof messages) { super(messages[reason]); this.name = 'ProductPageError' }
}
export function productPageFailure(error: unknown) {
  if (error instanceof ProductPageError) return error.message
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return messages.timeout
  return messages.connection
}
