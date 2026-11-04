import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const root=resolve('.output/public')
const types={'.txt':'text/plain','.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}
createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
  const path=resolve(root,'.'+pathname)
  if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403);return res.end()}
  let body
  let extension=extname(path)
  try{body=await readFile(pathname==='/'?resolve(root,'index.html'):path);if(pathname==='/')extension='.html'}catch{
   if(extension||pathname.startsWith('/api/')||pathname.startsWith('/.well-known/')){res.writeHead(404);return res.end()}
   body=await readFile(resolve(root,'index.html'));extension='.html'
  }
  res.writeHead(200,{'Content-Type':types[extension]||'application/octet-stream','Cache-Control':'no-store'});res.end(body)
 }catch{res.writeHead(500);res.end()}
}).listen(3211,'127.0.0.1')
