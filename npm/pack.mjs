#!/usr/bin/env node
// Makes the npm packages of one wmd release from that release's files (the assets of a release of
// threadedstack/wmd-releases, as scripts/release.sh writes them), and nothing else:
//
//   node npm/pack.mjs --assets DIR --tag vX.Y.Z --commit SHA --out DIR
//
//   @threadedstack/wmd-darwin-arm64   bin/ wmd wmdd wmd-run wmd-relay wmd-exe-stub wmd-fixtures-gen bootlock.sh
//                                     bin/guest/arm64/ vm.wasm Image Image-4k initramfs.cpio.gz features config
//                                     (os darwin, cpu arm64: npm installs it only on a Mac with Apple silicon)
//   @threadedstack/wmd                the wmd, wmdd and wmd-relay commands and a small API (npm/wmd), which find the
//                                     programs in the platform package, its optional dependency of the same version
//   @threadedstack/wmd-web            the browser host: the wmd-web tgz's files (src/, export-page/, guest/arm64/,
//                                     RELEASE.json), plus wmdpack.wasm (when the release has it), page/sw.js and relay/*.ts from the release
//
// Every package has the release's version (the tag without the v). Every file taken from DIR is checked against
// DIR/SHA256SUMS.txt first. --out gets one npm tarball per package (npm pack) and packages.json: name, version, file,
// sha256 and size of each, in the order to publish them (the platform package first: @threadedstack/wmd depends on it).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCOPE = '@threadedstack'
const REPO = 'https://github.com/threadedstack/wmd-releases'
const PROGRAMS = ['wmd', 'wmdd', 'wmd-run', 'wmd-relay', 'wmd-exe-stub', 'wmd-fixtures-gen', 'bootlock.sh']
const GUEST = ['vm.wasm', 'Image', 'Image-4k', 'initramfs.cpio.gz', 'features', 'config']
const COMMANDS = ['wmd', 'wmdd', 'wmd-relay']
// the relay's files in web/relay (the folder also holds deploy files and notes)
const RELAY = ['control.ts', 'engine.ts', 'hosted.ts', 'keys.ts', 'logfile.ts', 'local-tls.ts', 'lock.ts', 'main.ts',
  'policy.ts', 'relay.ts', 'token.ts', 'v1.ts', 'wisp.ts']

const fail = (m) => {
  console.error(`npm-pack: ${m}`)
  process.exit(1)
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')

function args(argv) {
  const want = ['--assets', '--tag', '--commit', '--out']
  const a = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!want.includes(argv[i])) fail(`unknown argument ${argv[i]} (wants ${want.join(' ')})`)
    if (!argv[i + 1]) fail(`${argv[i]} needs a value`)
    a[argv[i]] = argv[i + 1]
  }
  for (const w of want) if (!a[w]) fail(`${w} is required`)
  return a
}

const a = args(process.argv.slice(2))
const assets = resolve(a['--assets'])
const out = resolve(a['--out'])
const tag = a['--tag']
if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`--tag ${tag} is not vX.Y.Z`)
if (!/^[0-9a-f]{40}$/.test(a['--commit'])) fail(`--commit ${a['--commit']} is not a full commit sha`)
const version = tag.slice(1)
const commit = a['--commit']

const sums = new Map()
const sumsFile = join(assets, 'SHA256SUMS.txt')
if (!existsSync(sumsFile)) fail(`${sumsFile} is missing`)
for (const line of readFileSync(sumsFile, 'utf8').split('\n').filter(Boolean)) {
  const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
  if (!m) fail(`SHA256SUMS.txt has a line that is not "<sha256>  <file>": ${line}`)
  sums.set(m[2], m[1])
}
/** The path of release file name, checked against SHA256SUMS.txt. */
function asset(name) {
  const f = join(assets, name)
  if (!sums.has(name)) fail(`SHA256SUMS.txt does not list ${name}`)
  if (!existsSync(f)) fail(`${name} is missing from ${assets}`)
  if (sha(f) !== sums.get(name)) fail(`${name} does not match SHA256SUMS.txt`)
  return f
}
const webTgz = [...sums.keys()].find((n) => /^wmd-web-\d+\.\d+\.\d+\.tgz$/.test(n)) ?? fail('the release has no wmd-web-<version>.tgz')
const webSrc = `wmd-web-src-${version}.tar.gz`

if (existsSync(out) && readdirSync(out).length) fail(`${out} is not empty`)
mkdirSync(out, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'wmd-npm-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))

const common = {
  version,
  license: 'MIT',
  homepage: REPO,
  repository: { type: 'git', url: `git+${REPO}.git` },
}
const meta = { tag, commit }
const writeJson = (f, o) => writeFileSync(f, `${JSON.stringify(o, null, 2)}\n`)

// the platform package
const plat = join(work, 'wmd-darwin-arm64')
mkdirSync(join(plat, 'bin/guest/arm64'), { recursive: true })
for (const p of PROGRAMS) {
  cpSync(asset(p), join(plat, 'bin', p))
  chmodSync(join(plat, 'bin', p), 0o755)
}
for (const g of GUEST) {
  cpSync(asset(g), join(plat, 'bin/guest/arm64', g))
  chmodSync(join(plat, 'bin/guest/arm64', g), 0o644)
}
writeJson(join(plat, 'package.json'), {
  name: `${SCOPE}/wmd-darwin-arm64`,
  ...common,
  description: `wmd ${version} for macOS on Apple silicon: the programs and the arm64 guest (used by ${SCOPE}/wmd)`,
  wmd: meta,
  os: ['darwin'],
  cpu: ['arm64'],
  files: ['bin'],
  preferUnplugged: true,
})
writeFileSync(join(plat, 'README.md'), `# ${SCOPE}/wmd-darwin-arm64

The macOS arm64 build of wmd ${version} (commit \`${commit}\`): \`bin/\` holds wmd, wmdd, wmd-run, wmd-relay,
wmd-exe-stub, wmd-fixtures-gen and bootlock.sh, and \`bin/guest/arm64/\` the guest. Install
[${SCOPE}/wmd](https://www.npmjs.com/package/${SCOPE}/wmd) instead: it picks this package on a Mac with Apple silicon.
The files are the ones of [release ${tag}](${REPO}/releases/tag/${tag}), byte for byte. They are not signed with a
Developer ID and not notarized.
`)

// the launcher
const cli = join(work, 'wmd')
cpSync(join(HERE, 'wmd'), cli, { recursive: true })
for (const c of COMMANDS) chmodSync(join(cli, 'bin', `${c}.js`), 0o755)
writeJson(join(cli, 'package.json'), {
  name: `${SCOPE}/wmd`,
  ...common,
  description: 'wmd: a Docker Engine API compatible daemon and CLI that runs Linux containers in WebAssembly',
  wmd: meta,
  type: 'module',
  exports: { '.': { types: './index.d.ts', default: './index.js' }, './package.json': './package.json' },
  types: './index.d.ts',
  bin: Object.fromEntries(COMMANDS.map((c) => [c, `bin/${c}.js`])),
  files: ['index.js', 'index.d.ts', 'bin'],
  engines: { node: '>=18' },
  optionalDependencies: { [`${SCOPE}/wmd-darwin-arm64`]: version },
})

// the browser package
const web = join(work, 'wmd-web')
execFileSync('tar', ['-xzf', asset(webTgz), '-C', work])
renameSync(join(work, 'package'), web)
const srcDir = join(work, 'websrc')
mkdirSync(srcDir)
execFileSync('tar', ['-xzf', asset(webSrc), '-C', srcDir])
const srcWeb = join(srcDir, `wmd-web-src-${version}`, 'web')
mkdirSync(join(web, 'relay'))
for (const f of RELAY) {
  if (!existsSync(join(srcWeb, 'relay', f))) fail(`${webSrc} has no web/relay/${f}`)
  cpSync(join(srcWeb, 'relay', f), join(web, 'relay', f))
}
mkdirSync(join(web, 'page'))
cpSync(join(srcWeb, 'page/sw.js'), join(web, 'page/sw.js'))
// a release made with --wmdpack none has no converter
const hasPack = sums.has('wmdpack.wasm')
if (hasPack) cpSync(asset('wmdpack.wasm'), join(web, 'wmdpack.wasm'))
const webPkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'))
writeJson(join(web, 'package.json'), {
  name: `${SCOPE}/wmd-web`,
  ...common,
  description: webPkg.description,
  wmd: { ...meta, web: webPkg.version },
  type: 'module',
  main: './src/boot.js',
  exports: {
    '.': './src/boot.js',
    './src/*': './src/*',
    './relay/*': './relay/*',
    './page/sw.js': './page/sw.js',
    './export-page/*': './export-page/*',
    './guest/*': './guest/*',
    ...(hasPack ? { './wmdpack.wasm': './wmdpack.wasm' } : {}),
    './RELEASE.json': './RELEASE.json',
    './package.json': './package.json',
  },
  files: ['src', 'relay', 'page', 'export-page', 'guest', ...(hasPack ? ['wmdpack.wasm'] : []), 'RELEASE.json'],
})

// pack, in publish order
const made = []
for (const dir of [plat, web, cli]) {
  const [r] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }))
  const f = join(out, r.filename)
  made.push({ name: r.name, version: r.version, file: r.filename, sha256: sha(f), bytes: r.size, unpacked: r.unpackedSize, files: r.entryCount })
  console.log(`npm-pack: ${r.name}@${r.version}: ${r.filename}, ${r.entryCount} files, ${r.size} bytes (${r.unpackedSize} unpacked)`)
}
writeJson(join(out, 'packages.json'), made)
