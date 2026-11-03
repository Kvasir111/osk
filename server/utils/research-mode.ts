export function aiResearchEnabled() {
  return process.env.PRODUCT_RESEARCH_MODE === 'ai'
}
export function requireAiResearch() {
  if (!aiResearchEnabled()) throw new Error('AI research is disabled. Paste a product link to read its listing instead.')
}
