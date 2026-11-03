import type { WishItem } from '../../shared/types'
type Choice = 'new' | 'cancel' | string
let finish: ((choice: Choice) => void) | undefined
export function useDuplicatePrompt() {
  const request = useState<{ ids: string[]; target: string } | null>('duplicate-prompt', () => null)
  function choose(choice: Choice) { const resolve = finish; finish = undefined; request.value = null; resolve?.(choice) }
  async function ask(matches: WishItem[], target: string) {
    if (finish) throw new Error('Finish reviewing the other wish first.')
    request.value = { ids: matches.map(i => i.id), target }
    return new Promise<Choice>(resolve => { finish = resolve })
  }
  return { request, choose, ask }
}
