import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest'

const owner = '10000000-0000-0000-0000-000000000001'
const editor = '10000000-0000-0000-0000-000000000002'
const viewer = '10000000-0000-0000-0000-000000000003'
const outsider = '10000000-0000-0000-0000-000000000004'
const list = '20000000-0000-0000-0000-000000000001'
const item = '30000000-0000-0000-0000-000000000001'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`)
  await db.exec(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/features.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/search-jobs.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/item-pictures.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/account-invitations.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/secret-santa.sql', import.meta.url), 'utf8'))
  await db.exec(`insert into auth.users values ('${owner}'),('${editor}'),('${viewer}'),('${outsider}');
    insert into public.wish_lists(id,owner_id,name) values('${list}','${owner}','Christmas');
    insert into public.list_members values('${list}','${editor}','editor'),('${list}','${viewer}','viewer');
    insert into public.wish_items(id,list_id,name) values('${item}','${list}','Exact product');`)
})
afterAll(async () => { await db.close() })
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
async function asUser(id: string, role = 'authenticated') {
  await db.exec(`set local role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id])
}
async function denied(sql: string) {
  await db.exec('savepoint denied_operation')
  await expect(db.exec(sql)).rejects.toThrow(/permission denied|row-level security/)
  await db.exec('rollback to savepoint denied_operation; release savepoint denied_operation')
}

describe('Database isolation with real Postgres RLS', () => {
  it('keeps account invitations and reservation functions inaccessible to browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await asUser(outsider, role)
      await denied('select * from public.account_invitations')
      await denied(`select public.reserve_account_invitation('${list}', 'test@example.com')`)
      await denied(`select public.create_account_invitation('${outsider}','code',repeat('a',64),null)`)
    }
  })
  it('binds one code to one email and limits delivery retries', async () => {
    await asUser(owner, 'service_role')
    const created = await db.query<{id:string}>(`select id from public.create_account_invitation('${owner}','code',repeat('a',64),null)`)
    const id = created.rows[0]!.id
    const reserve = (email: string) => db.query<{ok:boolean}>('select public.reserve_account_invitation($1,$2) as ok', [id,email])
    expect((await reserve('one@example.com')).rows[0]!.ok).toBe(true)
    expect((await reserve('two@example.com')).rows[0]!.ok).toBe(false)
    expect((await reserve('one@example.com')).rows[0]!.ok).toBe(false)
    await db.query("update account_invitations set last_attempt_at=now()-interval '2 minutes' where id=$1",[id])
    expect((await reserve('one@example.com')).rows[0]!.ok).toBe(true)
    await db.query("update account_invitations set delivery_attempts=5,last_attempt_at=now()-interval '2 minutes' where id=$1",[id])
    expect((await reserve('one@example.com')).rows[0]!.ok).toBe(false)
  })
  it('blocks expired, revoked, and wrong-recipient email invitations', async () => {
    await asUser(owner, 'service_role')
    const created = await db.query<{id:string}>(`select id from public.create_account_invitation('${owner}','email',repeat('b',64),'one@example.com')`)
    const id=created.rows[0]!.id
    const reserve = (email:string) => db.query<{ok:boolean}>('select public.reserve_account_invitation($1,$2) as ok',[id,email])
    expect((await reserve('two@example.com')).rows[0]!.ok).toBe(false)
    await db.query("update account_invitations set expires_at=now()-interval '1 minute' where id=$1",[id])
    expect((await reserve('one@example.com')).rows[0]!.ok).toBe(false)
    await db.query("update account_invitations set expires_at=now()+interval '1 day',revoked_at=now() where id=$1",[id])
    expect((await reserve('one@example.com')).rows[0]!.ok).toBe(false)
  })
  it('enforces the daily administrator invitation quota', async () => {
    await asUser(owner, 'service_role')
    for(let n=0;n<20;n++) await db.query('select public.create_account_invitation($1,$2,$3,null)',[owner,'code',n.toString(16).padStart(64,'0')])
    await expect(db.query('select public.create_account_invitation($1,$2,$3,null)',[owner,'code','c'.repeat(64)])).rejects.toThrow('Invitation quota reached')
  })
  it('enables RLS on every application table', async () => {
    const result = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'")
    expect(result.rows).toHaveLength(15)
    expect(result.rows.every(row => row.relrowsecurity)).toBe(true)
  })
  it('lets owners create with RETURNING, read, update, and delete their lists', async () => {
    await asUser(owner)
    const inserted = await db.query<{ id: string }>(`insert into wish_lists(owner_id,name) values('${owner}','Birthday') returning id`)
    expect(inserted.rows).toHaveLength(1)
    const id = inserted.rows[0]!.id
    expect((await db.query(`update wish_lists set name='New name' where id='${id}' returning name`)).rows).toEqual([{ name: 'New name' }])
    expect((await db.query(`delete from wish_lists where id='${id}' returning id`)).rows).toHaveLength(1)
  })
  it('blocks list ownership reassignment and direct share-token changes', async () => {
    await asUser(owner)
    await denied(`update wish_lists set owner_id='${outsider}' where id='${list}'`)
    await denied(`update wish_lists set share_token=gen_random_uuid() where id='${list}'`)
    await denied(`insert into wish_lists(owner_id,name,share_token) values('${owner}','Unsafe',gen_random_uuid())`)
  })
  it('lets editors change items while list management remains with the owner', async () => {
    await asUser(editor)
    expect((await db.query('select * from wish_lists')).rows).toHaveLength(1)
    expect((await db.query(`update wish_items set notes='Please' where id='${item}' returning id`)).rows).toHaveLength(1)
    expect((await db.query(`insert into wish_items(list_id,name) values('${list}','Another item') returning id`)).rows).toHaveLength(1)
    expect((await db.query(`update wish_lists set name='No' where id='${list}' returning id`)).rows).toHaveLength(0)
    expect((await db.query(`delete from wish_lists where id='${list}' returning id`)).rows).toHaveLength(0)
    await denied(`insert into list_members values('${list}','${outsider}','editor')`)
    await denied(`update wish_items set list_id=gen_random_uuid() where id='${item}'`)
    expect((await db.query(`delete from wish_items where id='${item}' returning id`)).rows).toHaveLength(1)
  })
  it('lets viewers read and blocks item mutation', async () => {
    await asUser(viewer)
    expect((await db.query('select * from wish_items')).rows).toHaveLength(1)
    await denied(`insert into wish_items(list_id,name) values('${list}','No')`)
    expect((await db.query(`update wish_items set notes='No' where id='${item}' returning id`)).rows).toHaveLength(0)
    expect((await db.query(`delete from wish_items where id='${item}' returning id`)).rows).toHaveLength(0)
  })
  it('hides lists, items, and membership from unrelated users', async () => {
    await asUser(outsider)
    for (const table of ['wish_lists', 'wish_items', 'list_members']) expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0)
    await denied(`insert into wish_items(list_id,name) values('${list}','No')`)
    await denied(`insert into wish_lists(owner_id,name) values('${owner}','No')`)
    expect((await db.query(`update wish_items set notes='No' where id='${item}' returning id`)).rows).toHaveLength(0)
    expect((await db.query(`delete from wish_items where id='${item}' returning id`)).rows).toHaveLength(0)
  })
  it('does not expose any raw table or service RPC to anonymous visitors', async () => {
    await asUser('', 'anon')
    for (const table of ['wish_lists', 'wish_items', 'list_members', 'list_invites', 'ai_usage']) {
      await denied(`select * from ${table}`)
      await denied(`delete from ${table}`)
    }
    await denied(`select public.reserve_ai_request('${owner}')`)
    await denied(`select public.claim_price_check('${item}',now())`)
    await denied(`select private.can_access_list('${list}')`)
  })
  it('keeps invitations, budgets, worker leases, and membership writes service-only', async () => {
    await asUser(owner)
    await denied('select * from list_invites')
    await denied('select * from ai_usage')
    await denied(`select public.reserve_ai_request('${owner}')`)
    await denied(`select public.claim_price_check('${item}',now())`)
    await denied(`delete from list_members where list_id='${list}'`)
  })
  it('reserves only 20 interactive requests per user per UTC day', async () => {
    await asUser('', 'service_role')
    for (let i = 0; i < 20; i++) expect((await db.query<{ ok: boolean }>(`select reserve_ai_request('${owner}') as ok`)).rows[0]!.ok).toBe(true)
    expect((await db.query<{ ok: boolean }>(`select reserve_ai_request('${owner}') as ok`)).rows[0]!.ok).toBe(false)
    expect((await db.query<{ ok: boolean }>(`select reserve_ai_request('${editor}') as ok`)).rows[0]!.ok).toBe(true)
  })
  it('leases each due item only once, preventing duplicate daily spend', async () => {
    await asUser('', 'service_role')
    expect((await db.query(`select * from claim_price_check('${item}',now())`)).rows).toHaveLength(1)
    expect((await db.query(`select * from claim_price_check('${item}',now())`)).rows).toHaveLength(0)
  })
})

const family = '40000000-0000-0000-0000-000000000001'
async function seedFamily() {
  await db.exec(`insert into families(id,owner_id,name) values('${family}','${owner}','Our family');
    insert into family_members values('${family}','${outsider}');`)
}
describe('Family boundaries and price history', () => {
  it('lets an organizer create a family with RETURNING and keeps ownership immutable', async () => {
    await asUser(owner)
    expect((await db.query(`insert into families(owner_id,name) values('${owner}','Our people') returning id`)).rows).toHaveLength(1)
    await denied(`update families set owner_id='${outsider}'`)
    await denied(`insert into families(owner_id,name) values('${outsider}','Impersonation')`)
  })
  it('keeps lists private until their owner explicitly shares them with the family', async () => {
    await seedFamily()
    await asUser(outsider)
    expect((await db.query('select * from families')).rows).toHaveLength(1)
    expect((await db.query('select * from wish_lists')).rows).toHaveLength(0)
    await denied(`insert into family_lists values('${family}','${list}')`)
    await db.exec('reset role')
    await asUser(owner)
    await db.exec(`insert into family_lists values('${family}','${list}')`)
    await asUser(outsider)
    expect((await db.query('select * from wish_lists')).rows).toHaveLength(1)
    expect((await db.query('select * from wish_items')).rows).toHaveLength(1)
    expect((await db.query(`update wish_items set notes='No' returning id`)).rows).toHaveLength(0)
    expect((await db.query(`delete from wish_items returning id`)).rows).toHaveLength(0)
    await denied(`insert into wish_items(list_id,name) values('${list}','No')`)
    await denied(`insert into family_members values('${family}','${editor}')`)
    await asUser(editor)
    expect((await db.query('select * from families')).rows).toHaveLength(0)
    expect((await db.query('select * from family_members')).rows).toHaveLength(0)
  })
  it('revokes family access immediately on unshare or membership removal', async () => {
    await seedFamily()
    await db.exec(`insert into family_lists values('${family}','${list}')`)
    await asUser(outsider)
    expect((await db.query('select * from wish_items')).rows).toHaveLength(1)
    await db.exec('reset role')
    await db.exec(`delete from family_members where user_id='${outsider}'`)
    await asUser(outsider)
    expect((await db.query('select * from families')).rows).toHaveLength(0)
    expect((await db.query('select * from wish_items')).rows).toHaveLength(0)
    await db.exec('reset role')
    await db.exec(`insert into family_members values('${family}','${outsider}'); delete from family_lists`)
    await asUser(outsider)
    expect((await db.query('select * from wish_items')).rows).toHaveLength(0)
  })
  it('stops sharing a departing member’s own lists with the remaining family', async () => {
    await seedFamily()
    await db.exec(`insert into wish_lists(id,owner_id,name) values('20000000-0000-0000-0000-000000000002','${outsider}','Private again');
      insert into family_lists values('${family}','20000000-0000-0000-0000-000000000002');
      delete from family_members where user_id='${outsider}'`)
    await asUser(owner)
    expect((await db.query('select * from wish_lists')).rows).toHaveLength(1)
  })
  it('records successful observations atomically, keeps manual entries separate, and ignores failed checks', async () => {
    await asUser(owner)
    await db.query(`update wish_items set offers=$1::jsonb where id='${item}'`, [JSON.stringify([{price_cents:1000}])])
    expect((await db.query('select source from price_observations')).rows).toEqual([{source:'manual'}])
    await db.exec(`update wish_items set checked_at=now(),refresh_status='ok' where id='${item}'`)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(2)
    await db.exec(`update wish_items set last_attempt_at=now(),refresh_status='failed' where id='${item}'`)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(2)
    await denied(`delete from price_observations`)
    await denied(`insert into price_observations(item_id,name,variant,source,offers) values('${item}','Forged','','search','[]')`)
    await asUser(viewer)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(2)
    await asUser(outsider)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(0)
    await asUser(owner)
    await db.exec(`delete from wish_items where id='${item}'`)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(0)
  })
})

describe('Private durable search jobs', () => {
  it('limits polling to the requesting account and keeps all job mutations server-only', async () => {
    await db.exec(`insert into product_search_jobs(user_id,query) values('${owner}','Exact product URL')`)
    await asUser(owner)
    expect((await db.query('select * from product_search_jobs')).rows).toHaveLength(1)
    await denied(`update product_search_jobs set status='completed'`)
    await denied(`insert into product_search_jobs(user_id,query) values('${owner}','Fake result')`)
    await asUser(editor)
    expect((await db.query('select * from product_search_jobs')).rows).toHaveLength(0)
    await asUser('', 'anon')
    await denied('select * from product_search_jobs')
  })
})

describe('Product pictures follow item permissions',()=>{
  it('allows editors to change pictures while viewers and unrelated users cannot',async()=>{
    await db.exec(`update wish_items set offers='[{"price_cents":1000}]',checked_at=now() where id='${item}'`)
    await asUser(editor)
    expect((await db.query(`update wish_items set image_mode='custom',image_url='https://cdn.example.com/item.jpg' where id='${item}' returning image_url`)).rows).toHaveLength(1)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(1)
    await asUser(viewer)
    expect((await db.query(`update wish_items set image_url='https://other.example.com/item.jpg' where id='${item}' returning id`)).rows).toHaveLength(0)
    await asUser(outsider)
    expect((await db.query(`update wish_items set image_mode='none',image_url=null where id='${item}' returning id`)).rows).toHaveLength(0)
  })
})

const santaFamily = '50000000-0000-4000-8000-000000000001'
async function santaSetup(exclusions: string[][] = []) {
  await db.exec(`insert into families(id,owner_id,name) values('${santaFamily}','${owner}','Santa family');
    insert into family_members values('${santaFamily}','${editor}'),('${santaFamily}','${viewer}');`)
  await asUser(owner, 'service_role')
  const result = await db.query<{ id: string }>('select public.mutate_santa($1,$2,$3,$4) as id', [owner, santaFamily, 'create', JSON.stringify({ name: 'Christmas', budget_cents: 5000, exclusions })])
  const id = result.rows[0]!.id
  for (const person of [owner, editor, viewer]) await santaMutation(person, id, 'join')
  return id
}
function santaMutation(actor: string, id: string, operation: string, input: unknown = {}) {
  return db.query('select public.mutate_santa($1,$2,$3,$4)', [actor, id, operation, JSON.stringify(input)])
}
const validDraw = { assignments: [{ giver_id: owner, recipient_id: editor }, { giver_id: editor, recipient_id: viewer }, { giver_id: viewer, recipient_id: owner }] }
async function failsMutation(actor: string, id: string, operation: string, input: unknown = {}) {
  await db.exec('savepoint santa_failure')
  await expect(santaMutation(actor, id, operation, input)).rejects.toThrow()
  await db.exec('rollback to savepoint santa_failure; release savepoint santa_failure')
}
describe('Secret Santa privacy and transactional writes', () => {
  it('shows only the caller’s recipient, including for organizers, and hides everything from outsiders', async () => {
    const id = await santaSetup()
    await santaMutation(owner, id, 'draw', validDraw)
    for (const [person, recipient] of [[owner, editor], [editor, viewer], [viewer, owner]]) {
      await asUser(person!)
      expect((await db.query('select recipient_id from santa_assignments')).rows).toEqual([{ recipient_id: recipient }])
      expect((await db.query('select * from santa_participants')).rows).toHaveLength(3)
    }
    await asUser(outsider)
    for (const table of ['santa_events', 'santa_participants', 'santa_assignments']) expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0)
    await asUser('', 'anon')
    await denied('select * from santa_assignments')
  })
  it('keeps writes and the privileged RPC inaccessible to browser roles', async () => {
    const id = await santaSetup()
    await asUser(owner)
    await denied(`delete from santa_events where id='${id}'`)
    await denied(`insert into santa_participants values('${id}','${outsider}')`)
    await denied(`update santa_assignments set recipient_id='${outsider}'`)
    await denied(`select public.mutate_santa('${owner}','${id}','draw','{}')`)
  })
  it('checks the verified actor and locks roster and settings after drawing', async () => {
    const id = await santaSetup()
    await failsMutation(outsider, id, 'join')
    await failsMutation(editor, id, 'draw', validDraw)
    await failsMutation(editor, id, 'update', { name: 'Hijacked' })
    await santaMutation(owner, id, 'draw', validDraw)
    for (const action of ['draw', 'leave', 'join', 'update']) await failsMutation(owner, id, action, validDraw)
    expect((await db.query('select * from santa_assignments')).rows).toHaveLength(3)
  })
  it('rejects invalid, duplicate, incomplete, and excluded draws atomically', async () => {
    const id = await santaSetup([[owner, editor]])
    await failsMutation(owner, id, 'draw', validDraw)
    await failsMutation(owner, id, 'draw', { assignments: validDraw.assignments.slice(1) })
    await failsMutation(owner, id, 'draw', { assignments: [validDraw.assignments[0], validDraw.assignments[0], validDraw.assignments[2]] })
    await failsMutation(owner, id, 'draw', { assignments: validDraw.assignments.map(row => ({ ...row, recipient_id: row.giver_id })) })
    expect((await db.query('select * from santa_assignments')).rows).toHaveLength(0)
    expect((await db.query('select drawn_at from santa_events')).rows).toEqual([{ drawn_at: null }])
  })
  it('rejects stale rosters and revokes assignment reads when a member leaves the family', async () => {
    const id = await santaSetup()
    await db.exec(`delete from family_members where user_id='${editor}'`)
    await failsMutation(owner, id, 'draw', validDraw)
    await db.exec(`insert into family_members values('${santaFamily}','${editor}')`)
    await santaMutation(owner, id, 'draw', validDraw)
    await db.exec(`delete from family_members where user_id='${editor}'`)
    await asUser(editor)
    expect((await db.query('select * from santa_assignments')).rows).toHaveLength(0)
    expect((await db.query('select * from santa_events')).rows).toHaveLength(0)
  })
  it('leaving an open event removes only that participant and deleting a family cascades', async () => {
    const id = await santaSetup()
    await santaMutation(editor, id, 'leave')
    expect((await db.query('select user_id from santa_participants order by user_id')).rows).toEqual([{ user_id: owner }, { user_id: viewer }])
    await santaMutation(editor, id, 'join')
    await santaMutation(owner, id, 'draw', validDraw)
    await db.exec(`delete from families where id='${santaFamily}'`)
    expect((await db.query('select * from santa_events')).rows).toHaveLength(0)
    expect((await db.query('select * from santa_assignments')).rows).toHaveLength(0)
  })
})
