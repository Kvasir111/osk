import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { zipFunctions } from '@netlify/zip-it-and-ship-it'

const root = fileURLToPath(new URL('../', import.meta.url))
const toml = await readFile(join(root, 'netlify.toml'), 'utf8')
const functions = toml.split(/^\[functions\]\s*$/m)[1]?.split(/^\[/m)[0]
assert(functions, 'Expected a [functions] section in netlify.toml')
// These settings use JSON-compatible TOML strings/arrays; fail rather than test different settings.
const setting = (name, fallback) => {
  const value = functions.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*(?:#.*)?$`, 'm'))?.[1]
  return value ? JSON.parse(value) : fallback
}
const directory = setting('directory', 'netlify/functions')
const nodeBundler = setting('node_bundler', 'zisi')
const externalNodeModules = setting('external_node_modules', [])
const nodeVersion = (await readFile(join(root, '.nvmrc'), 'utf8')).trim().replace(/^v/, '')
const output = await mkdtemp(join(tmpdir(), 'osk-functions-'))
assert(!output.startsWith(root), 'Function artifacts must be tested outside the repository')
try {
  const artifacts = await zipFunctions(resolve(root, directory), output, {
    archiveFormat: 'none', basePath: root,
    config: { '*': { nodeBundler, nodeVersion, externalNodeModules } },
  })
  assert.equal(artifacts.length, 4, 'Expected all four custom functions to be packaged')
  for (const artifact of artifacts) {
    const entry = join(artifact.path, directory, `${artifact.name}.mjs`)
    const probe = `
      import assert from 'node:assert/strict';
      globalThis.fetch = async () => { throw new Error('Network access is forbidden in function startup checks'); };
      const { default: handler } = await import(${JSON.stringify(pathToFileURL(entry).href)});
      assert.equal(typeof handler, 'function');
      if (${JSON.stringify(artifact.name)} === 'daily-prices') {
        await assert.rejects(() => handler(), /environment is incomplete/);
      } else {
        const url = 'https://osk.example.com/.netlify/functions/${artifact.name}';
        assert.equal((await handler(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
        const headers = { Authorization: 'Bearer startup-test-only', 'Content-Type': 'application/json' };
        assert.equal((await handler(new Request(url, { method: 'GET', headers }))).status, 405);
        assert.equal((await handler(new Request(url, { method: 'POST', headers, body: '{}' }))).status, 400);
      }
    `
    const checked = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: artifact.path, timeout: 30000, encoding: 'utf8',
      // No inherited keys, URLs, NODE_PATH, preload hooks, or .env. Only packaged files can resolve.
      env: { PATH: process.env.PATH, PRICE_REFRESH_SECRET: 'startup-test-only' },
    })
    assert.equal(checked.status, 0, `${artifact.name} failed its packaged startup check:\n${checked.stderr || checked.error || ''}`)
    console.log(`Function startup passed: ${artifact.name}`)
  }
} finally {
  await rm(output, { recursive: true, force: true })
}
