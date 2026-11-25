#!/usr/bin/env node
// Makes the npm packages of one wmd release from that release's files (the assets of a release of
// threadedstack/wmd-releases, as scripts/release.sh writes them), and nothing else:
//
//   node npm/pack.mjs --assets DIR --tag vX.Y.Z --commit SHA --out DIR [--node-package no]
//
//   @threadedstack/wmd-darwin-arm64   bin/ wmd wmdd wmd-run wmd-relay wmd-exe-stub wmd-fixtures-gen bootlock.sh
//                                     bin/guest/arm64/ vm.wasm Image Image-4k initramfs.cpio.gz features config and the
//                                     compiler cache of `wmd build` (X11): wmd-ccwrap-linux-arm64 wmd-ccshim-linux-arm64
//                                     ccache-linux-arm64 ccache-LICENSE.txt ccache-SOURCE.txt ccache-source.tar.xz
//                                     (os darwin, cpu arm64: npm installs it only on a Mac with Apple silicon)
//   @threadedstack/wmd-linux-arm64, -linux-x64, -linux-arm64-musl, -linux-x64-musl
//                                     the same programs from the release's wmd-linux-<arch>[-musl].tar.gz (bin/);
//                                     guest/amd64/ (vm.wasm bzImage initramfs.cpio.gz features config) on x64,
//                                     guest/arm64/ on arm64 (os linux, cpu, libc glibc or musl: npm installs one); each with its
//                                     chip's compiler cache files. They hold a stock ccache (GPL-3.0-or-later), so a platform
//                                     package's license is "MIT AND GPL-3.0-or-later"; @threadedstack/wmd and -web stay MIT.
//   @threadedstack/wmd                the wmd, wmdd and wmd-relay commands and a small API (npm/wmd), which find the
//                                     programs in the platform package, its optional dependency of the same version
//   @threadedstack/wmd-web            the browser host: the wmd-web tgz's files (src/, export-page/, guest/arm64/,
//                                     RELEASE.json), plus wmdpack.wasm (when the release has it), page/sw.js and relay/*.ts from the release,
//                                     and src/edge/pins.gen.js: the pins of the next package's files
//   @threadedstack/wmd-node           node's files for the browser (X5): the web tgz's edge-site/ files (the own runtime, Edge.js's
//                                     node core, wmd-edge's shim, their notices) at the paths the pins name. The page fetches them
//                                     from npm by hash (web/src/edge); nobody installs this package. Its pins are written here by
//                                     the release's own web/scripts/edge-pins.mjs, from the bytes that go into the package. A web
//                                     tgz without edge-site/, or --node-package no (npm.yml: the name is not on npm yet), makes
//                                     neither the package nor the pins: node then runs in the guest.
//
// Every package has the release's version (the tag without the v). Every file taken from DIR is checked against
// DIR/SHA256SUMS.txt first. --out gets one npm tarball per package (npm pack) and packages.json: name, version, file,
// sha256 and size of each, in the order to publish them (the platform package first: @threadedstack/wmd depends on it).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCOPE = '@threadedstack'
const REPO = 'https://github.com/threadedstack/wmd-releases'
const PROGRAMS = ['wmd', 'wmdd', 'wmd-run', 'wmd-relay', 'wmd-exe-stub', 'wmd-fixtures-gen', 'bootlock.sh']
// the compiler cache's programs and license files of one guest chip (scripts/release.sh CC_FILES)
const ccFiles = (garch) => [`wmd-ccwrap-linux-${garch}`, `wmd-ccshim-linux-${garch}`, `ccache-linux-${garch}`,
  'ccache-LICENSE.txt', 'ccache-SOURCE.txt', 'ccache-source.tar.xz']
const GUEST_ARM64 = ['vm.wasm', 'Image', 'Image-4k', 'initramfs.cpio.gz', 'features', 'config', ...ccFiles('arm64')]
const GUEST_AMD64 = ['vm.wasm', 'bzImage', 'initramfs.cpio.gz', 'features', 'config', ...ccFiles('amd64')]
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
  const may = ['--node-package']
  const a = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!want.includes(argv[i]) && !may.includes(argv[i])) fail(`unknown argument ${argv[i]} (wants ${want.join(' ')}, takes ${may.join(' ')})`)
    if (!argv[i + 1]) fail(`${argv[i]} needs a value`)
    a[argv[i]] = argv[i + 1]
  }
  for (const w of want) if (!a[w]) fail(`${w} is required`)
  if (!['yes', 'no'].includes(a['--node-package'] ?? 'yes')) fail(`--node-package ${a['--node-package']} is not yes or no`)
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
    license: 'MIT AND GPL-3.0-or-later',
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
The files are the ones of [release ${tag}](${REPO}/releases/tag/${tag}), byte for byte. wmd is MIT licensed; \`bin/guest/${p.garch}/ccache-linux-${p.garch}\`
is a stock ccache (GPL-3.0-or-later) that \`wmd build\` runs: its license and source are \`ccache-LICENSE.txt\`, \`ccache-SOURCE.txt\` and \`ccache-source.tar.xz\` next to it.${p.os === 'darwin' ? ' They are not signed with a\nDeveloper ID and not notarized.' : ''}
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
// F4a: the web tgz holds regular files and folders only. A hard link makes a file of one folder hold the bytes of a file of another (edge-site/own/x.js is
// src/boot.js), a symlink points out of the package: both are refused, anywhere in the tgz (tar made the hard link a second name of one file: nlink above 1).
{
  const walkLinks = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      const st = lstatSync(f)
      const rel = f.slice(web.length + 1)
      if (st.isSymbolicLink()) fail(`${webTgz} holds a symlink (${rel}); the web package has regular files only`)
      else if (st.isDirectory()) walkLinks(f)
      else if (st.isFile() && st.nlink > 1) fail(`${webTgz} holds a hard link (${rel}, ${st.nlink} names of one file); the web package has regular files only`)
    }
  }
  walkLinks(web)
}
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
if (!existsSync(join(web, 'src/edge/frame-code.gen.js'))) fail(`${webTgz} has no src/edge/frame-code.gen.js (the sandboxed frame's code, made by web/scripts/build-frame-code.mjs; scripts/web-release.py adds it)`)

// F4b: text that names a folder of this machine: this run's folders as spelled and as the file system resolves them (a temp folder can be a link: /var -> /private/var),
// the home folder, a /Users/<name>/ or /home/<name>/ path, and a Windows drive path (C:\ or C:/)
const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
const machinePaths = [...new Set([work, assets, real(work), real(assets), tmpdir(), real(tmpdir()), homedir(), real(homedir())])].filter((p) => p.length > 5 && p !== '/')
const namesThisMachine = (text) => machinePaths.some((p) => text.includes(p)) || /\/(Users|home)\/[^/\s'"]+\//.test(text) || /(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(text)

// node's files for the browser (X5)
const NODE = `${SCOPE}/wmd-node`
const pinsOut = join(web, 'src/edge/pins.gen.js')
if (existsSync(pinsOut)) fail(`${webTgz} already has src/edge/pins.gen.js (the pins are written here, from the files of this release)`)
const site = join(web, 'edge-site')
let node = null
if (existsSync(site) && a['--node-package'] !== 'no') {
  const gen = join(srcWeb, 'scripts/edge-pins.mjs')
  if (!existsSync(gen)) fail(`${webSrc} has no web/scripts/edge-pins.mjs (it writes the pins of node's files)`)
  // every file of edge-site/, by its bytes: a pin finds its file by sha256 and size, whatever folder it is in
  const have = []
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n)
      const st = lstatSync(f)
      if (st.isDirectory()) walk(f)
      else if (st.isFile()) have.push({ file: f, sha256: sha(f), size: st.size })
      else fail(`${webTgz}: edge-site holds ${f.slice(site.length + 1)}, which is not a regular file`)
    }
  }
  walk(site)
  try {
    execFileSync(process.execPath, [gen, '--build', join(site, 'own'), '--core', join(site, 'wasm/edgejs.wasm'), '--core-notices', join(site, 'wasm/NOTICES.txt'),
      '--linux', join(site, 'wasm/linux.cjs'), ...(existsSync(join(site, 'wasm/linux.py')) ? ['--linux-py', join(site, 'wasm/linux.py')] : []), '--package', NODE, '--version', version, '--out', pinsOut], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    fail(`web/scripts/edge-pins.mjs failed on the edge-site files of ${webTgz}: ${String(e.stderr || e.message).replaceAll(work, '').trim().slice(-400)}`)
  }
  const text = readFileSync(pinsOut, 'utf8')
  if (namesThisMachine(text)) fail('src/edge/pins.gen.js names a folder of this machine')
  const pins = await import(pathToFileURL(pinsOut).href)
  const pk = pins.EDGE_PACKAGE
  if (!pk || pk.name !== NODE || pk.version !== version) fail(`src/edge/pins.gen.js names ${JSON.stringify(pk)}, not ${NODE}@${version}`)
  if (!Array.isArray(pins.EDGE_PINS) || !pins.EDGE_PINS.length) fail('src/edge/pins.gen.js has no pins')
  node = join(work, 'wmd-node')
  const paths = []
  for (const p of pins.EDGE_PINS) {
    const ok = typeof p.path === 'string' && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p.path) && !p.path.split('/').some((x) => x === '.' || x === '..')
    if (!ok) fail(`src/edge/pins.gen.js has a pin whose path is not a plain relative path: ${JSON.stringify(p.path)}`)
    if (['package.json', 'README.md'].includes(p.path) || paths.includes(p.path)) fail(`src/edge/pins.gen.js pins ${p.path} twice or over a file of the package`)
    const from = have.find((h) => h.sha256 === p.sha256 && h.size === p.size)
    if (!from) fail(`edge-site of ${webTgz} has no file with the sha256 and size of the pin ${p.path}`)
    mkdirSync(dirname(join(node, p.path)), { recursive: true })
    cpSync(from.file, join(node, p.path))
    chmodSync(join(node, p.path), 0o644)
    paths.push(p.path)
  }
  writeJson(join(node, 'package.json'), {
    name: NODE,
    ...common,
    license: 'SEE LICENSE IN README.md',
    description: `wmd ${version}: node's files for the browser (fetched by ${SCOPE}/wmd-web, checked by hash)`,
    wmd: meta,
    exports: { './*': './*', './package.json': './package.json' },
    files: paths,
  })
  writeFileSync(join(node, 'README.md'), `# ${NODE}

The files \`${SCOPE}/wmd-web\` ${version} needs to run a container's \`node\` on the browser's own engine (wmd commit
\`${commit}\`). You do not install this package and you do not serve it. The page fetches it from the npm registry on first
use, accepts each file only when it has the sha256 and size pinned inside \`${SCOPE}/wmd-web\` ${version}, and keeps it in
the browser's cache. An app that wants its own copy serves this folder and passes its address:
\`bootWmd({ edge: { base: '<address of this folder>' } })\`.

${paths.map((p) => `- \`${p}\``).join('\n')}

## Licences

wmd's own code in these files is MIT. They are built from other projects, each under its own licence; the texts are in
this package: \`NOTICES.txt\` (the crates of the runtime, \`wmd_browser_bg.wasm\` and \`wmd_browser.js\`),
\`edgejs.NOTICES.txt\` (Edge.js's node core \`edgejs.wasm\`: Edge.js, node and what node bundles) and \`acorn/LICENSE\`.
`)
}
const webPkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'))
writeJson(join(web, 'package.json'), {
  name: `${SCOPE}/wmd-web`,
  ...common,
  description: webPkg.description,
  wmd: { ...meta, web: webPkg.version },
  type: 'module',
  main: './src/boot.js',
  exports: {
    ...webPkg.exports,
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
// (node's files before the web package, whose pins name them)
for (const dir of [...plats, ...(node ? [node] : []), web, cli]) {
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
