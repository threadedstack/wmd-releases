#!/usr/bin/env node
// Makes the npm packages of one wmd release from that release's files (the assets of a release of
// threadedstack/wmd-releases, as scripts/release.sh writes them), and nothing else:
//
//   node npm/pack.mjs --assets DIR --tag vX.Y.Z --commit SHA --out DIR
//
//   @threadedstack/wmd-darwin-arm64   bin/ wmd wmdd wmd-run wmd-relay wmd-exe-stub wmd-fixtures-gen bootlock.sh
//                                     bin/guest/arm64/ vm.wasm Image Image-4k initramfs.cpio.gz features config
//                                     (os darwin, cpu arm64: npm installs it only on a Mac with Apple silicon)
//   @threadedstack/wmd-linux-arm64, -linux-x64, -linux-arm64-musl, -linux-x64-musl
//                                     the same programs from the release's wmd-linux-<arch>[-musl].tar.gz (bin/);
//                                     guest/amd64/ (vm.wasm bzImage initramfs.cpio.gz features config) on x64,
//                                     guest/arm64/ on arm64 (os linux, cpu, libc glibc or musl: npm installs one)
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
const GUEST_ARM64 = ['vm.wasm', 'Image', 'Image-4k', 'initramfs.cpio.gz', 'features', 'config']
const GUEST_AMD64 = ['vm.wasm', 'bzImage', 'initramfs.cpio.gz', 'features', 'config']
// the platform packages, in publish order. from: 'assets' takes the bare release files; a file name takes bin/ out of
// that tarball (garch: the guest folder under bin/guest). libc: what npm's "libc" field checks on Linux.
const PLATFORMS = [
  { name: 'darwin-arm64', os: 'darwin', cpu: 'arm64', garch: 'arm64', from: 'assets', label: 'macOS on Apple silicon', where: 'a Mac with Apple silicon' },
  { name: 'linux-arm64', os: 'linux', cpu: 'arm64', garch: 'arm64', libc: 'glibc', from: 'wmd-linux-arm64.tar.gz', label: 'Linux arm64 (glibc)', where: 'an arm64 Linux with glibc' },
  { name: 'linux-x64', os: 'linux', cpu: 'x64', garch: 'amd64', libc: 'glibc', from: 'wmd-linux-x64.tar.gz', label: 'Linux x64 (glibc)', where: 'an x64 Linux with glibc' },
  { name: 'linux-arm64-musl', os: 'linux', cpu: 'arm64', garch: 'arm64', libc: 'musl', from: 'wmd-linux-arm64-musl.tar.gz', label: 'Linux arm64 (musl, e.g. Alpine)', where: 'an arm64 Linux with musl' },
  { name: 'linux-x64-musl', os: 'linux', cpu: 'x64', garch: 'amd64', libc: 'musl', from: 'wmd-linux-x64-musl.tar.gz', label: 'Linux x64 (musl, e.g. Alpine)', where: 'an x64 Linux with musl' },
]
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

// the platform packages
const plats = []
for (const p of PLATFORMS) {
  const dir = join(work, `wmd-${p.name}`)
  const guest = p.garch === 'amd64' ? GUEST_AMD64 : GUEST_ARM64
  mkdirSync(join(dir, 'bin/guest', p.garch), { recursive: true })
  if (p.from === 'assets') {
    // the Mac build: bare release files
    for (const f of PROGRAMS) cpSync(asset(f), join(dir, 'bin', f))
    for (const g of guest) cpSync(asset(g), join(dir, 'bin/guest', p.garch, g))
  } else {
    // a Linux build: a tarball with bin/ and bin/guest/<garch>/
    const x = join(work, `x-${p.name}`)
    mkdirSync(x)
    execFileSync('tar', ['-xzf', asset(p.from), '-C', x])
    for (const f of PROGRAMS) if (!existsSync(join(x, 'bin', f))) fail(`${p.from} has no bin/${f}`)
    for (const g of guest) if (!existsSync(join(x, 'bin/guest', p.garch, g))) fail(`${p.from} has no bin/guest/${p.garch}/${g}`)
    for (const f of PROGRAMS) cpSync(join(x, 'bin', f), join(dir, 'bin', f))
    for (const g of guest) cpSync(join(x, 'bin/guest', p.garch, g), join(dir, 'bin/guest', p.garch, g))
  }
  for (const f of PROGRAMS) chmodSync(join(dir, 'bin', f), 0o755)
  for (const g of guest) chmodSync(join(dir, 'bin/guest', p.garch, g), 0o644)
  const pkgName = `${SCOPE}/wmd-${p.name}`
  writeJson(join(dir, 'package.json'), {
    name: pkgName,
    ...common,
    description: `wmd ${version} for ${p.label}: the programs and the ${p.garch} guest (used by ${SCOPE}/wmd)`,
    wmd: meta,
    os: [p.os],
    cpu: [p.cpu],
    ...(p.libc ? { libc: [p.libc] } : {}),
    files: ['bin'],
    preferUnplugged: true,
  })
  writeFileSync(join(dir, 'README.md'), `# ${pkgName}

The ${p.label} build of wmd ${version} (commit \`${commit}\`): \`bin/\` holds ${PROGRAMS.slice(0, -1).join(', ')} and
${PROGRAMS.at(-1)}, and \`bin/guest/${p.garch}/\` the guest. Install
[${SCOPE}/wmd](https://www.npmjs.com/package/${SCOPE}/wmd) instead: it picks this package on ${p.where}.
The files are the ones of [release ${tag}](${REPO}/releases/tag/${tag}), byte for byte.${p.os === 'darwin' ? ' They are not signed with a\nDeveloper ID and not notarized.' : ''}
`)
  plats.push(dir)
}

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
  optionalDependencies: Object.fromEntries(PLATFORMS.map((p) => [`${SCOPE}/wmd-${p.name}`, version])),
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
for (const dir of [...plats, web, cli]) {
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
