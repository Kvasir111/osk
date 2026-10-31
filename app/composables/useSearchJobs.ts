import type { ProductSearchJob } from '../../shared/types'
export function useSearchJobs() {
  const { api,user }=useAccount()
  const jobs=useState<Record<string,ProductSearchJob>>('product-search-jobs',()=>({}))
  function remember(job:ProductSearchJob,account:string|undefined){
    if(account===user.value?.id&&(!jobs.value[job.id]||jobs.value[job.id]!.updated_at<=job.updated_at))jobs.value={...jobs.value,[job.id]:job}
  }
  async function start(input:{query?:string;url?:string}) {
    const account=user.value?.id
    const job=await api<ProductSearchJob>('/api/searches',{method:'POST',body:input})
    remember(job,account);return job
  }
  async function fetchJob(id:string) {
    const account=user.value?.id
    const job=await api<ProductSearchJob>(`/api/searches/${id}`)
    remember(job,account);return job
  }
  async function resume() {
    const account=user.value?.id
    const recent=await api<ProductSearchJob[]>('/api/searches')
    for(const job of recent)remember(job,account)
  }
  return {jobs,start,fetchJob,resume}
}
