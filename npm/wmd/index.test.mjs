// node --test npm/wmd/index.test.mjs (a folder argument does not work on node 24)
// Each test runs the launcher as npm/pack.mjs packs it (stand-in release assets, npm/testassets.mjs), in a folder with
// fake installed platform packages in its node_modules.
import assert from 'node:assert/strict'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { cleanup, packStandIn, unpack } from '../testassets.mjs'

let pack
before(() => {
  pack = packStandIn()
})

after(cleanup)

async function launcher(installed = []) {
  const d = realpathSync(unpack(pack.out, pack.packages.find((p) => p.name === '@threadedstack/wmd').file))
  for (const n of installed) {
    const p = join(d, 'node_modules/@threadedstack', `wmd-${n}`)
    mkdirSync(join(p, 'bin'), { recursive: true })
    writeFileSync(join(p, 'package.json'), JSON.stringify({ name: `@threadedstack/wmd-${n}`, version: '1.2.3' }))
  }
  // a new import each time: index.js reads its own folder's package.json
  return { m: await import(`${pathToFileURL(join(d, 'index.js')).href}?${d}`), d }
}

test('platformPackage names the glibc packages', async () => {
  const { m } = await launcher()
  assert.equal(m.platformPackage('linux', 'x64', 'glibc'), '@threadedstack/wmd-linux-x64')
  assert.equal(m.platformPackage('linux', 'arm64', 'glibc'), '@threadedstack/wmd-linux-arm64')
  assert.equal(m.platformPackage('darwin', 'arm64'), '@threadedstack/wmd-darwin-arm64')
})

test('platformPackage adds -musl for musl', async () => {
  const { m } = await launcher()
  assert.equal(m.platformPackage('linux', 'arm64', 'musl'), '@threadedstack/wmd-linux-arm64-musl')
  assert.equal(m.platformPackage('linux', 'x64', 'musl'), '@threadedstack/wmd-linux-x64-musl')
})

test('hostGuestArch maps x64 to amd64 and refuses other cpus', async () => {
  const { m } = await launcher()
  assert.equal(m.hostGuestArch('x64'), 'amd64')
  assert.equal(m.hostGuestArch('arm64'), 'arm64')
  assert.throws(() => m.hostGuestArch('ia32'), /no guest for cpu ia32; there is one for arm64 and x64/)
})

test('hostLibc: glibc when the report has glibcVersionRuntime, musl when not, null off Linux', async () => {
  const { m } = await launcher()
  assert.equal(m.hostLibc('linux', () => ({ header: { glibcVersionRuntime: '2.36' } })), 'glibc')
  assert.equal(m.hostLibc('linux', () => ({ header: {} })), 'musl')
  assert.equal(m.hostLibc('linux', () => null), 'musl')
  assert.equal(m.hostLibc('darwin', () => ({ header: { glibcVersionRuntime: '2.36' } })), null)
  assert.equal(m.hostLibc('freebsd', () => ({ header: {} })), null)
})

test('hostLibc of this machine agrees with its own process report', async () => {
  const { m } = await launcher()
  const g = process.report.getReport().header.glibcVersionRuntime
  assert.equal(m.hostLibc(), process.platform !== 'linux' ? null : g ? 'glibc' : 'musl')
})

test('binDir on musl picks the -musl package even when the glibc one is installed too', async () => {
  const { m, d } = await launcher(['linux-x64', 'linux-x64-musl'])
  assert.equal(m.binDir('linux', 'x64', 'musl'), join(d, 'node_modules/@threadedstack/wmd-linux-x64-musl/bin'))
  assert.equal(m.binDir('linux', 'x64', 'glibc'), join(d, 'node_modules/@threadedstack/wmd-linux-x64/bin'))
})

test('binDir on musl does not fall back to the glibc package', async () => {
  const { m } = await launcher(['linux-arm64'])
  assert.throws(() => m.binDir('linux', 'arm64', 'musl'), /wmd-linux-arm64-musl is not installed/)
})

test('binDir on an unsupported platform lists every build, sorted', async () => {
  const { m } = await launcher()
  assert.throws(
    () => m.binDir('freebsd', 'x64', null),
    (e) => e.message.endsWith('there is one for darwin-arm64, linux-arm64, linux-arm64-musl, linux-x64, linux-x64-musl'),
  )
})
