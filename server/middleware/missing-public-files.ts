import { defineEventHandler, getRequestURL, setHeader, setResponseStatus } from 'h3'

// Existing public assets are served before Nitro (by Netlify or Nitro's static
// handler). A file request reaching the app must not become a 200 SPA shell.
export default defineEventHandler(event => {
  if (!['GET', 'HEAD'].includes(event.method)) return
  const path = getRequestURL(event).pathname
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/.netlify/')) return
  if (!path.startsWith('/.well-known/') && !/\.[^/]+$/.test(path)) return
  setResponseStatus(event, 404)
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  return 'Not found'
})
