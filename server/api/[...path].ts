import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createError, defineEventHandler, getRouterParam, readBody, readMultipartFormData, setHeader } from 'h3'
import { adminDatabase, dbResult, requireUser } from '../utils/database'
import { searchProducts } from '../utils/product-search'
import { refreshItem } from '../utils/refresh-prices'
import { listSchema, productSchema, priceCheckSchema, publicUrl } from '../../shared/validation'
import { AVATAR_BUCKET, profileSchema, ownedAvatarPath } from '../../shared/profile'
import { prepareAvatar, profileForUser } from '../utils/profiles'

import { familyRequest } from '../utils/families'
import { santaRequest } from '../utils/santa'
import { itemHistory } from '../utils/history'
import { writeItem } from '../utils/item-write'
import { normalizePicture } from '../../shared/product-images'
import { dispatchItemPicture } from '../utils/product-images'
import { researchTasks } from '../utils/progressive-search'
import { dispatchSearchJob, approveSearchItem } from '../utils/search-jobs'
import { captureQuery } from '../../shared/capture'
import { accountInvitationRequest, redeemAccountInvitation } from '../utils/account-invitations'
import { createOfflineItem, createOfflineList } from '../utils/offline-create'
import { stalledSearch } from '../../shared/search-progress'

const uuid = z.string().uuid()
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  const path = (getRouterParam(event, 'path') || '').split('/').filter(Boolean)
  const [resource, id, action] = path
  const method = event.method
  try {
    if (resource === 'account-invitations' && id === 'redeem' && path.length === 2 && method === 'POST') return await redeemAccountInvitation(event)
    if (resource === 'share' && method === 'GET' && (path.length === 2 || (path.length === 4 && action === 'history'))) {
      uuid.parse(id)
      const admin = adminDatabase()
      const list = dbResult(await admin.from('wish_lists').select('id,name,description,occasion').eq('share_token', id).maybeSingle())
      if (!list) throw createError({ statusCode: 404, statusMessage: 'This sharing link is unavailable.' })
      if (action === 'history') {
        const itemId = uuid.parse(path[3])
        const item = dbResult(await admin.from('wish_items').select('id,name,variant').eq('id', itemId).eq('list_id', list.id).maybeSingle())
        if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found.' })
        return itemHistory(admin, item)
      }
      const items = dbResult(await admin.from('wish_items').select('*').eq('list_id', list.id).order('created_at', { ascending: false }))
      return { list, items }
    }
    const { db, user } = await requireUser(event)
    if (resource === 'santa') return await santaRequest(event, path, db, user)
    if (resource === 'account-invitations') return await accountInvitationRequest(event, path, user)
    if (resource === 'families' || resource === 'family-join') return await familyRequest(event, path, db, user)
    if (resource === 'profile' && path.length === 1) {
      const admin = adminDatabase()
      if (method === 'GET') return profileForUser(admin, user)
      if (method === 'PATCH') {
        const input = profileSchema.parse(await readBody(event))
        const { data, error } = await admin.auth.admin.updateUserById(user.id, { user_metadata: input })
        if (error || !data.user) throw createError({ statusCode: 400, statusMessage: 'Your name could not be saved. Please try again.' })
        return profileForUser(admin, data.user)
      }
    }
    if (resource === 'profile' && id === 'avatar' && path.length === 2) {
      const admin = adminDatabase()
      const bucket = admin.storage.from(AVATAR_BUCKET)
      const oldPath = ownedAvatarPath(user.id, user.user_metadata.osk_avatar_path)
      if (method === 'POST') {
        const parts = await readMultipartFormData(event)
        const file = parts?.find(part => part.name === 'avatar' && part.filename)
        if (!file) throw createError({ statusCode: 400, statusMessage: 'Choose a profile picture.' })
        const image = await prepareAvatar(file.data)
        const newPath = `${user.id}/${randomUUID()}.webp`
        const { error: uploadError } = await bucket.upload(newPath, image, { contentType: 'image/webp', cacheControl: '3600', upsert: false })
        if (uploadError) throw createError({ statusCode: 400, statusMessage: 'Your picture could not be uploaded. Please try again.' })
        const { data, error } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { osk_avatar_path: newPath } })
        if (error || !data.user) {
          await bucket.remove([newPath])
          throw createError({ statusCode: 400, statusMessage: 'Your picture could not be saved. Please try again.' })
        }
        if (oldPath) await bucket.remove([oldPath])
        return profileForUser(admin, data.user)
      }
      if (method === 'DELETE') {
        if (oldPath) {
          const { error } = await bucket.remove([oldPath])
          if (error) throw createError({ statusCode: 400, statusMessage: 'Your picture could not be removed. Please try again.' })
        }
        const { data, error } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { osk_avatar_path: null } })
        if (error || !data.user) throw createError({ statusCode: 400, statusMessage: 'Your profile could not be updated. Please try again.' })
        return profileForUser(admin, data.user)
      }
    }
    const ownerList = async (listId: string) => {
      uuid.parse(listId)
      const list = dbResult(await db.from('wish_lists').select('*').eq('id', listId).eq('owner_id', user.id).maybeSingle())
      if (!list) throw createError({ statusCode: 403, statusMessage: 'Only the list owner can do that.' })
      return list
    }
    const reserve = async () => {
      const allowed = dbResult(await adminDatabase().rpc('reserve_ai_request', { target_user: user.id }))
      if (!allowed) throw createError({ statusCode: 429, statusMessage: 'Daily search limit reached (20 checks/searches). Try again tomorrow.' })
    }

    if (resource === 'lists' && path.length === 1) {
      if (method === 'GET') {
        const lists = dbResult(await db.from('wish_lists').select('*').order('created_at', { ascending: true }))
        const memberships = dbResult(await db.from('list_members').select('list_id,role').eq('user_id', user.id))
        return { lists, memberships, user_id: user.id }
      }
      if (method === 'POST') {
        const { client_id, ...input } = listSchema.extend({ client_id: uuid.optional() }).parse(await readBody(event))
        return client_id ? createOfflineList(db, client_id, user.id, input) : dbResult(await db.from('wish_lists').insert({ ...input, owner_id: user.id }).select().single())
      }
    }
    if (resource === 'lists' && id) {
      uuid.parse(id)
      if (path.length === 2 && method === 'PATCH') {
        await ownerList(id)
        return dbResult(await db.from('wish_lists').update(listSchema.parse(await readBody(event))).eq('id', id).select().single())
      }
      if (path.length === 2 && method === 'DELETE') {
        await ownerList(id)
        dbResult(await db.from('wish_lists').delete().eq('id', id))
        return { ok: true }
      }
      if (action === 'items' && method === 'GET') return dbResult(await db.from('wish_items').select('*').eq('list_id', id).order('created_at', { ascending: false }))
      if (action === 'items' && method === 'POST') {
        const body = z.object({ product: productSchema, client_id: uuid.optional(), checked_at: z.string().datetime().nullable().default(null), price_check_details: priceCheckSchema.optional(), search_id: uuid.optional() }).parse(await readBody(event))
        if (body.client_id) {
          if (body.search_id || body.checked_at) throw createError({ statusCode: 400, statusMessage: 'Offline additions must be unverified manual wishes.' })
          const item = await createOfflineItem(db, body.client_id, id, normalizePicture(body.product))
          if (item) await dispatchItemPicture(adminDatabase(), item.id).catch(() => {})
          return item
        }
        const item = dbResult(await writeItem(db,{ ...normalizePicture(body.product), list_id: id,
          checked_at: body.checked_at, last_attempt_at: body.checked_at,
          price_check_details: body.price_check_details || {},
          refresh_status: body.checked_at ? 'ok' : 'never' }))
        if (!item) throw createError({ statusCode: 400, statusMessage: 'Could not save this wish.' })
        if (body.search_id) {
          const attached = await approveSearchItem(adminDatabase(), body.search_id, user.id, item)
          if (!attached) {
            dbResult(await db.from('wish_items').delete().eq('id',item.id))
            throw createError({ statusCode: 409, statusMessage: 'This search was already saved or is unavailable. Please start a new search.' })
          }
          return dbResult(await db.from('wish_items').select('*').eq('id',item.id).single())
        }
        if((item.image_mode||'auto')==='auto'&&!item.image_url)try{await dispatchItemPicture(adminDatabase(),item.id)}catch{console.warn('Optional product picture dispatch unavailable',{id:item.id})}
        return item
      }
      if (action === 'share' && method === 'POST') {
        const list = await ownerList(id)
        const { enabled, rotate } = z.object({ enabled: z.boolean(), rotate: z.boolean().default(false) }).parse(await readBody(event))
        const token = enabled ? (!rotate && list.share_token ? list.share_token : randomUUID()) : null
        dbResult(await adminDatabase().from('wish_lists').update({ share_token: token }).eq('id', id))
        return { token }
      }
      if (action === 'invite' && method === 'POST') {
        await ownerList(id)
        const { role } = z.object({ role: z.enum(['viewer', 'editor']) }).parse(await readBody(event))
        return dbResult(await adminDatabase().from('list_invites').insert({ list_id: id, role }).select('token,expires_at').single())
      }
      if (action === 'invite' && method === 'DELETE') {
        await ownerList(id)
        dbResult(await adminDatabase().from('list_invites').delete().eq('list_id', id))
        return { ok: true }
      }
      if (action === 'members' && method === 'GET') {
        await ownerList(id)
        const members = dbResult(await db.from('list_members').select('user_id,role').eq('list_id', id)) || []
        const admin = adminDatabase()
        return Promise.all(members.map(async member => {
          const { data } = await admin.auth.admin.getUserById(member.user_id)
          const profile = data.user ? await profileForUser(admin, data.user) : null
          return { ...member, email: profile?.email || '', display_name: profile?.display_name || '', avatar_url: profile?.avatar_url || null }
        }))
      }
      if (action === 'members' && method === 'DELETE') {
        await ownerList(id)
        const member = z.object({ user_id: uuid }).parse(await readBody(event))
        dbResult(await adminDatabase().from('list_members').delete().eq('list_id', id).eq('user_id', member.user_id))
        return { ok: true }
      }
    }
    if (resource === 'join' && method === 'POST' && id) {
      uuid.parse(id)
      const admin = adminDatabase()
      const invite = dbResult(await admin.from('list_invites').select('*').eq('token', id).gt('expires_at', new Date().toISOString()).maybeSingle())
      if (!invite) throw createError({ statusCode: 404, statusMessage: 'This invitation has expired or was revoked.' })
      const list = dbResult(await admin.from('wish_lists').select('owner_id').eq('id', invite.list_id).single())
      if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found.' })
      if (list.owner_id !== user.id) {
        // An editor invitation can upgrade a viewer; a viewer invitation never downgrades an editor.
        const existing = dbResult(await admin.from('list_members').select('role').eq('list_id', invite.list_id).eq('user_id', user.id).maybeSingle())
        if (existing?.role !== 'editor') dbResult(await admin.from('list_members').upsert({ list_id: invite.list_id, user_id: user.id, role: invite.role }))
      }
      return { list_id: invite.list_id }
    }
    if (resource === 'items' && id) {
      uuid.parse(id)
      if (method === 'GET' && action === 'history' && path.length === 3) {
        const item = dbResult(await db.from('wish_items').select('id,name,variant').eq('id', id).maybeSingle())
        if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found.' })
        return itemHistory(db, item)
      }
      if (method === 'DELETE' && path.length === 2) {
        const removed = dbResult(await db.from('wish_items').delete().eq('id', id).select('id'))
        if (!removed?.length) throw createError({ statusCode: 403, statusMessage: 'You cannot remove this item.' })
        return { ok: true }
      }
      if (method === 'PATCH' && path.length === 2) {
        const product=normalizePicture(productSchema.parse(await readBody(event)))
        const previous=dbResult(await db.from('wish_items').select('name,variant').eq('id',id).maybeSingle())
        if(!previous)throw createError({statusCode:404,statusMessage:'Item not found.'})
        if((product.image_mode||'auto')==='auto'&&(product.name!==previous.name||product.variant!==previous.variant)){
          product.image_url=null;product.image_source_url=null
        }
        const item=dbResult(await writeItem(db,{...product,checked_at:null,last_attempt_at:null,refresh_status:'never'},id))
        if(item&&(item.image_mode||'auto')==='auto'&&!item.image_url)try{await dispatchItemPicture(adminDatabase(),item.id)}catch{console.warn('Optional product picture dispatch unavailable',{id:item.id})}
        return item
      }
      if (method === 'POST' && action === 'refresh') {
        const item = dbResult(await db.from('wish_items').select('list_id').eq('id', id).maybeSingle())
        if (!item) throw createError({ statusCode: 404, statusMessage: 'Item not found.' })
        const list = dbResult(await db.from('wish_lists').select('owner_id').eq('id', item.list_id).single())
        if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found.' })
        if (list.owner_id !== user.id) {
          const member = dbResult(await db.from('list_members').select('role').eq('list_id', item.list_id).eq('user_id', user.id).maybeSingle())
          if (member?.role !== 'editor') throw createError({ statusCode: 403, statusMessage: 'Editing access is required.' })
        }
        await reserve()
        const status = await refreshItem(adminDatabase(), id, new Date(Date.now() - 5 * 60000).toISOString())
        return { status }
      }
    }
    if (resource === 'searches') {
      if(method === 'GET' && path.length === 1) return dbResult(await db.from('product_search_jobs').select('*')
        .gte('created_at',new Date(Date.now()-86400000).toISOString()).order('created_at',{ascending:false}).limit(20))
      if (method === 'GET' && path.length === 2) {
        uuid.parse(id)
        let job = dbResult(await db.from('product_search_jobs').select('*').eq('id',id).maybeSingle())
        if (!job) throw createError({ statusCode:404, statusMessage:'Search not found.' })
        const stalled = stalledSearch(job)
        if (stalled) {
          const changed=dbResult(await adminDatabase().from('product_search_jobs').update(stalled)
            .eq('id',id).eq('status',job.status).eq('updated_at',job.updated_at).select('*').maybeSingle())
          if(changed)job=changed
        }
        return job
      }
      if(method === 'POST' && path.length === 1) {
        const input=z.object({query:z.string().trim().min(3).max(1000).optional(),url:publicUrl.optional()}).refine(v=>!!v.query||!!v.url).parse(await readBody(event))
        if(!process.env.OPENAI_API_KEY)throw createError({statusCode:503,statusMessage:'Product research is not configured.'})
        await reserve()
        const admin=adminDatabase()
        const job=dbResult(await admin.from('product_search_jobs').insert({user_id:user.id,query:input.url?captureQuery(input.url):input.query,
          product_url:input.url||null,stages:researchTasks(input.url).map(task=>({id:task.id,label:task.label,status:'waiting'}))}).select('*').single())
        if(!job)throw createError({statusCode:400,statusMessage:'Could not start this search.'})
        try{await dispatchSearchJob(admin,job.id)}catch{
          dbResult(await admin.from('product_search_jobs').update({status:'failed',error_message:'Research could not start. Please try again.',finished_at:new Date().toISOString()}).eq('id',job.id))
          throw createError({statusCode:503,statusMessage:'Background research could not start. Check the server configuration or try again.'})
        }
        return job
      }
    }
    if ((resource === 'search' || resource === 'capture') && method === 'POST' && path.length === 1) {
      const input = await readBody(event)
      const query = resource === 'capture' ? captureQuery(z.object({ url: publicUrl }).parse(input).url)
        : z.object({ query: z.string().trim().min(3).max(1000) }).parse(input).query
      if (!process.env.OPENAI_API_KEY) throw createError({ statusCode: 503, statusMessage: 'Add an OpenAI API key on the server to enable product search.' })
      await reserve()
      try { return await searchProducts(query) }
      catch { throw createError({ statusCode: 502, statusMessage: 'Product search could not finish. Try a more specific model name or add the item manually.' }) }
    }
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  } catch (error) {
    if (error instanceof z.ZodError) throw createError({ statusCode: 400, statusMessage: error.issues[0]?.message || 'Please check the form.' })
    throw error
  }
})
