import type { User } from '@supabase/supabase-js'
import type { ProductDraft, WishItem, WishList, PriceTrackingData } from '../../shared/types'

export interface OfflineSnapshot {
  accountId: string
  identity: Pick<User, 'id' | 'email' | 'user_metadata'>
  lists: WishList[]
  items: WishItem[]
  roles: Record<string, string>
  savedAt: string
}
export type PendingAddition = {
  id: string
  accountId: string
  createdAt: string
  status: 'pending' | 'blocked'
  error?: string
} & ({ kind: 'list'; product: Pick<WishList, 'name' | 'description' | 'occasion'> } | { kind: 'item'; listId: string; product: ProductDraft })

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('osk-offline-v1', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('snapshots', { keyPath: 'accountId' })
      request.result.createObjectStore('meta')
      const outbox = request.result.createObjectStore('outbox', { keyPath: 'id' })
      outbox.createIndex('accountId', 'accountId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Device storage is unavailable. Allow storage before saving offline.'))
  })
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let value: T
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Device storage could not be updated. Your change has not been saved.')) }
    try { action(tx, next => { value = next }) } catch (error) { tx.abort(); reject(error) }
  })
}
export async function readOfflineAccount(accountId: string) {
  return transaction<{ snapshot?: OfflineSnapshot; additions: PendingAddition[] }>(['snapshots', 'outbox'], 'readonly', (tx, done) => {
    const result: { snapshot?: OfflineSnapshot; additions: PendingAddition[] } = { additions: [] }
    tx.objectStore('snapshots').get(accountId).onsuccess = event => { result.snapshot = (event.target as IDBRequest).result }
    tx.objectStore('outbox').index('accountId').getAll(accountId).onsuccess = event => { result.additions = (event.target as IDBRequest).result }
    done(result)
  })
}
export async function lastOfflineIdentity() {
  const id = await transaction<string | undefined>(['meta'], 'readonly', (tx, done) => {
    tx.objectStore('meta').get('last-account').onsuccess = event => done((event.target as IDBRequest).result)
  })
  return id ? (await readOfflineAccount(id)).snapshot?.identity : undefined
}
export async function saveOfflineSnapshot(snapshot: OfflineSnapshot) {
  // Vue proxies are not structured-cloneable; store plain data, never session tokens.
  const plain = JSON.parse(JSON.stringify(snapshot)) as OfflineSnapshot
  await transaction<void>(['snapshots', 'meta'], 'readwrite', tx => {
    tx.objectStore('snapshots').put(plain)
    tx.objectStore('meta').put(snapshot.accountId, 'last-account')
  })
}
export async function putAddition(addition: PendingAddition) {
  await transaction<void>(['outbox'], 'readwrite', tx => { tx.objectStore('outbox').put(JSON.parse(JSON.stringify(addition))) })
}
export async function removeAddition(id: string) {
  await transaction<void>(['outbox'], 'readwrite', tx => { tx.objectStore('outbox').delete(id) })
}
export async function clearOfflineAccount(accountId: string) {
  await transaction<void>(['snapshots', 'outbox', 'meta'], 'readwrite', tx => {
    tx.objectStore('snapshots').delete(accountId)
    tx.objectStore('meta').delete(`price-tracking:${accountId}`)
    tx.objectStore('outbox').index('accountId').openKeyCursor(accountId).onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursor | null>).result
      if (cursor) { tx.objectStore('outbox').delete(cursor.primaryKey); cursor.continue() }
    }
    tx.objectStore('meta').get('last-account').onsuccess = event => {
      if ((event.target as IDBRequest).result === accountId) tx.objectStore('meta').delete('last-account')
    }
  })
}
export async function withOfflineLock<T>(accountId: string, action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(`osk-outbox-${accountId}`, action) : action()
}

export async function readOfflineTracking(accountId: string) {
  return transaction<PriceTrackingData | undefined>(['meta'],'readonly',(tx,done)=>{
    tx.objectStore('meta').get(`price-tracking:${accountId}`).onsuccess=event=>done((event.target as IDBRequest).result)
  })
}
export async function saveOfflineTracking(accountId:string,data:PriceTrackingData) {
  const plain=JSON.parse(JSON.stringify(data)) as PriceTrackingData
  await transaction<void>(['meta'],'readwrite',tx=>{tx.objectStore('meta').put(plain,`price-tracking:${accountId}`)})
}
