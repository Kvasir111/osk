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
  await db.exec(await readFile(new URL('../../supabase/wishlist-usability.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/tracking-alerts.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../supabase/home-depot-checks.sql', import.meta.url), 'utf8'))
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
    expect(result.rows).toHaveLength(19)
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

describe('Wishlist organization', () => {
  const destination = '20000000-0000-0000-0000-000000000002'
  const copyId = '30000000-0000-0000-0000-000000000002'
  async function destinationList() {
    await db.exec(`insert into public.wish_lists(id,owner_id,name) values('${destination}','${editor}','Birthday')`)
  }
  const transfer = (mode='move', entries=[{id:item,copy_id:copyId}]) => db.query<{id:string;list_id:string;checked_at:string|null}>(
    'select * from public.transfer_wishes($1,$2,$3)', [destination,mode,JSON.stringify(entries)])
  it('lets editors update preferences and archive without changing price evidence', async () => {
    await db.exec(`update wish_items set checked_at=now(),offers='[{"retailer":"Store","url":"https://example.com/item","price_cents":500}]' where id='${item}'`)
    const before = await db.query('select * from price_observations')
    await asUser(editor)
    await db.exec(`update wish_items set priority='really_want',gift_preferences='Size large; blue',status='received' where id='${item}'`)
    expect((await db.query('select * from price_observations')).rows).toEqual(before.rows)
    await asUser(viewer)
    expect((await db.query(`update wish_items set status='active' where id='${item}' returning id`)).rows).toEqual([])
  })
  it('moves atomically with history intact and checks both lists', async () => {
    await destinationList()
    await db.exec(`update wish_items set offers='[{"retailer":"Store","url":"https://example.com/item","price_cents":500}]' where id='${item}'`)
    await asUser(editor)
    const result = await transfer()
    expect(result.rows[0]?.list_id).toBe(destination)
    expect((await db.query(`select item_id from price_observations where item_id='${item}'`)).rows).toHaveLength(1)
    await asUser(owner)
    expect((await db.query(`select * from wish_items where id='${item}'`)).rows).toHaveLength(0)
    expect((await db.query('select * from price_observations')).rows).toHaveLength(0)
  })
  it('copies a readable wish but never claims a fresh verified check, and retries preserve edits', async () => {
    await destinationList()
    await db.exec(`update wish_items set checked_at=now(),offers='[{"retailer":"Store","url":"https://example.com/item","price_cents":500}]',priority='really_want',gift_preferences='Blue' where id='${item}'`)
    await asUser(editor)
    const result = await transfer('copy')
    expect(result.rows[0]?.id).toBe(copyId)
    expect(result.rows[0]?.checked_at).toBeNull()
    await db.exec(`update wish_items set notes='Later edit' where id='${copyId}'`)
    await transfer('copy')
    expect((await db.query<{notes:string}>(`select notes from wish_items where id='${copyId}'`)).rows[0]?.notes).toBe('Later edit')
    expect((await db.query<{source:string}>(`select source from price_observations where item_id='${copyId}'`)).rows.map(r=>r.source)).toEqual(['manual'])
  })
  it('rolls back the whole batch if any source is unavailable', async () => {
    await destinationList(); await asUser(editor)
    await db.exec('savepoint batch')
    await expect(transfer('move',[{id:item,copy_id:copyId},{id:'30000000-0000-0000-0000-000000000099',copy_id:'30000000-0000-0000-0000-000000000098'}])).rejects.toThrow(/Access to a source/)
    await db.exec('rollback to savepoint batch')
    expect((await db.query<{list_id:string}>(`select list_id from wish_items where id='${item}'`)).rows[0]?.list_id).toBe(list)
  })
  it('blocks viewer moves, outsider copies, anonymous calls and direct list reassignment', async () => {
    await destinationList()
    await db.exec(`insert into list_members values('${destination}','${viewer}','editor'),('${destination}','${outsider}','editor')`)
    await asUser(viewer)
    await db.exec('savepoint access')
    await expect(transfer()).rejects.toThrow(/Access to a source/)
    await db.exec('rollback to savepoint access')
    // Read access is enough for copying into a list this viewer can edit.
    expect((await transfer('copy')).rows[0]?.id).toBe(copyId)
    await asUser(outsider)
    await db.exec('savepoint outside')
    await expect(transfer('copy')).rejects.toThrow(/Access to a source/)
    await db.exec('rollback to savepoint outside')
    await asUser(editor)
    await denied(`update wish_items set list_id='${destination}' where id='${item}'`)
    await asUser(owner)
    await db.exec('savepoint dest')
    await expect(transfer()).rejects.toThrow(/destination/)
    await db.exec('rollback to savepoint dest')
    await asUser('', 'anon')
    await denied(`select public.transfer_wishes('${destination}','move','[]')`)
  })
  it('does not claim archived or received wishes for daily checks', async () => {
    await asUser(owner, 'service_role')
    for (const status of ['archived','received']) {
      await db.exec(`update wish_items set status='${status}' where id='${item}'`)
      expect((await db.query(`select * from claim_price_check('${item}',now())`)).rows).toHaveLength(0)
    }
  })
})

describe('Personal target prices and trusted alerts',()=>{
  const target = (cents=5000) => db.query<{id:string;is_met:boolean}>('select * from public.set_price_target($1,$2)',[item,cents])
  async function observe(price:number,day:number,extra='') {
    await asUser(owner,'service_role')
    await db.exec(`update wish_items set offers='[{"retailer":"Shop","url":"https://shop.example.com/item","price_cents":${price},"availability":"unknown","shipping_note":"Shipping extra"}]', checked_at='2026-11-${String(day).padStart(2,'0')}T12:00:00Z',refresh_status='ok' ${extra} where id='${item}'`)
  }
  it('keeps targets personal, allows viewers to watch, and blocks forged alerts and system state',async()=>{
    await asUser(owner);await target()
    await asUser(viewer);await target(4500)
    expect((await db.query('select * from price_watches')).rows).toHaveLength(1)
    await denied(`update price_watches set is_met=true`)
    await denied(`insert into price_alerts(watch_id,user_id,item_id,name,variant,price_cents,target_cents,offer,observed_at) select id,user_id,item_id,'Fake','',1,target_cents,'{}',now() from price_watches`)
    await asUser(outsider)
    expect((await db.query('select * from price_watches')).rows).toHaveLength(0)
    await denied(`select public.set_price_target('${item}',5000)`)
    await asUser('', 'anon');await denied('select * from price_watches');await denied('select * from price_alerts')
  })
  it('notifies on the first verified match, suppresses repeats, and rearms after a verified rise',async()=>{
    await asUser(owner);await target()
    await observe(5000,4);await observe(4000,5)
    await asUser(owner)
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
    expect((await target()).rows[0]?.is_met).toBe(true)
    await observe(6000,6);await observe(4500,7)
    await asUser(owner)
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(2)
    await db.exec('update price_alerts set read_at=now()')
    expect((await db.query('select * from price_alerts where read_at is null')).rows).toHaveLength(0)
    await denied('update price_alerts set price_cents=1')
  })
  it('uses each account’s own threshold and deletes only that account’s notifications with its target',async()=>{
    await asUser(owner);await target(5000)
    await asUser(viewer);await target(3000)
    await observe(4000,4)
    await asUser(owner);expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
    await asUser(viewer);expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await target(5000);await observe(4000,5)
    await asUser(viewer);expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
    await db.exec('delete from price_watches')
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await asUser(owner);expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
  })
  it('ignores forged browser checks, failed refreshes, manual prices and image-only edits',async()=>{
    await asUser(owner);await target()
    await db.exec(`update wish_items set offers='[{"url":"https://shop.example.com/item","price_cents":1000,"availability":"unknown"}]',checked_at=now(),refresh_status='ok' where id='${item}'`)
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await asUser(owner,'service_role')
    await db.exec(`update wish_items set image_url='https://shop.example.com/photo.jpg' where id='${item}'`)
    await db.exec(`update wish_items set checked_at=now(),refresh_status='failed' where id='${item}'`)
    await asUser(owner)
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await observe(3000,4)
    await asUser(owner)
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
  })
  it('hides alerts and stops generating them after access is revoked',async()=>{
    await asUser(editor);await target()
    await observe(4000,4)
    await asUser(editor);expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
    await asUser(owner,'service_role');await db.exec(`delete from list_members where user_id='${editor}'`)
    await observe(6000,5);await observe(4000,6)
    await asUser(editor)
    expect((await db.query('select * from price_watches')).rows).toHaveLength(0)
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await asUser(owner,'service_role')
    expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
  })
  it('rechecks family access and the destination after an item moves',async()=>{
    await seedFamily();await db.exec(`insert into family_lists values('${family}','${list}')`)
    await asUser(outsider);await target()
    await observe(4000,4)
    await asUser(outsider);expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
    await asUser(owner,'service_role');await db.exec(`delete from family_lists where list_id='${list}'`)
    await observe(6000,5);await observe(3000,6)
    await asUser(outsider);expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await asUser(owner);await target()
    await asUser(editor)
    await db.exec(`insert into wish_lists(id,owner_id,name) values('20000000-0000-0000-0000-000000000009','${editor}','Destination')`)
    await db.query(`select * from transfer_wishes('20000000-0000-0000-0000-000000000009','move',$1)`,[JSON.stringify([{id:item,copy_id:'30000000-0000-0000-0000-000000000009'}])])
    await observe(2500,7)
    await asUser(owner);expect((await db.query('select * from price_watches')).rows).toHaveLength(0)
    await asUser(owner,'service_role');expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
  })
  it('pauses archived items, hides old-variant alerts, and leaves copies without another person’s target',async()=>{
    await asUser(owner);await target()
    await observe(4000,4)
    await observe(3000,5,",status='archived'")
    await asUser(owner);expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await asUser(owner,'service_role');await db.exec(`update wish_items set status='active',variant='Blue' where id='${item}'`)
    await asUser(owner);expect((await db.query('select * from price_alerts')).rows).toHaveLength(0)
    await observe(3000,6)
    await asUser(owner);expect((await db.query('select * from price_alerts')).rows).toHaveLength(1)
    await db.exec(`insert into wish_lists(id,owner_id,name) values('20000000-0000-0000-0000-000000000009','${owner}','Other')`)
    await db.query(`select * from transfer_wishes('20000000-0000-0000-0000-000000000009','copy',$1)`,[JSON.stringify([{id:item,copy_id:'30000000-0000-0000-0000-000000000009'}])])
    expect((await db.query('select * from price_watches')).rows).toHaveLength(1)
  })
})


describe('Home Depot free-tier reservations', () => {
  it('keeps provider snapshots, quota records, and reservation RPC service-only', async () => {
    for(const role of ['anon','authenticated']) {
      await asUser(outsider,role)
      await denied('select * from public.home_depot_usage')
      await denied('select * from public.home_depot_checks')
      await denied("select public.reserve_home_depot_check('333882212','55437',3000)")
    }
  })
  it('reserves once per product, ZIP and UTC day and stops at the monthly limit', async () => {
    await asUser(owner,'service_role')
    const reserve=async(product:string,zip='55437')=>(await db.query<{job:any}>("select public.reserve_home_depot_check($1,$2,2) as job",[product,zip])).rows[0]!.job
    const first=await reserve('333882212')
    expect(first.start).toBe(true)
    expect((await reserve('333882212')).start).toBe(false)
    expect((await reserve('333882212','55438')).start).toBe(true)
    expect(await reserve('333882213')).toBeNull()
    expect((await db.query('select requests from public.home_depot_usage')).rows).toEqual([{requests:2}])
    expect((await reserve('333882212')).job.id).toBe(first.job.id)
  })
})
