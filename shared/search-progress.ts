import type { ProductSearchJob } from './types'

export function stalledSearch(job: Pick<ProductSearchJob, 'status' | 'updated_at' | 'stages'>, now = Date.now()) {
  if (!['queued', 'running'].includes(job.status)) return null
  const timeout = job.status === 'queued' ? 30000 : 180000
  if (now - new Date(job.updated_at).getTime() <= timeout) return null
  return {
    status: 'failed' as const,
    error_message: job.status === 'queued'
      ? 'The research worker did not start. You can enter the item manually now, or try research again later.'
      : 'This search stopped before finishing. Available findings are kept. You can enter details manually or try again.',
    stages: job.stages.map(stage => ['waiting', 'running'].includes(stage.status) ? { ...stage, status: 'failed' as const } : stage),
    finished_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  }
}
