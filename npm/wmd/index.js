// @threadedstack/wmd: where the wmd programs and guest files of this machine's platform package are.
//
//   import { binPath, guestDir } from '@threadedstack/wmd'
//   binPath('wmd')        // .../node_modules/@threadedstack/wmd-darwin-arm64/bin/wmd
//   guestDir('arm64')     // .../node_modules/@threadedstack/wmd-darwin-arm64/bin/guest/arm64
//
// The programs and the guest live in one platform package (an optional dependency, so npm installs only the one
// for this os and cpu). wmd finds wmdd, wmd-run and guest/<arch> next to its own file, so they stay together in bin/.
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const self = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** The programs a platform package carries. */
export const PROGRAMS = ['wmd', 'wmdd', 'wmd-run', 'wmd-relay', 'wmd-exe-stub', 'wmd-fixtures-gen', 'bootlock.sh']
/** wmd's version (the release tag without the v) and the commit it was built from. */
export const version = self.version
export const commit = self.wmd?.commit ?? ''

/** The platform package's name for this machine, e.g. @threadedstack/wmd-darwin-arm64. */
export function platformPackage(platform = process.platform, arch = process.arch) {
  return `@threadedstack/wmd-${platform}-${arch}`
}

/** The bin folder of this machine's platform package; throws, naming what to install, when there is none. */
export function binDir() {
  const name = platformPackage()
  if (!Object.hasOwn(self.optionalDependencies ?? {}, name))
    throw new Error(
      `wmd: no build for ${process.platform} ${process.arch}; there is one for ` +
        Object.keys(self.optionalDependencies ?? {}).map((n) => n.replace('@threadedstack/wmd-', '')).join(', '),
    )
  let pkg
  try {
    pkg = require.resolve(`${name}/package.json`)
  } catch {
    throw new Error(
      `wmd: ${name} is not installed. It is an optional dependency of @threadedstack/wmd; ` +
        `install without --no-optional / --omit=optional, or add ${name}@${version} yourself`,
    )
  }
  return join(dirname(pkg), 'bin')
}

/** The path of one program (see PROGRAMS), executable. */
export function binPath(name = 'wmd') {
  if (!PROGRAMS.includes(name)) throw new Error(`wmd: ${name} is not one of ${PROGRAMS.join(', ')}`)
  const p = join(binDir(), name)
  if (!existsSync(p)) throw new Error(`wmd: ${p} is missing`)
  // an install that dropped the mode bits (some package managers do) would leave it unrunnable
  if ((statSync(p).mode & 0o111) === 0) chmodSync(p, 0o755)
  return p
}

/** The guest files folder (vm.wasm, Image, Image-4k, initramfs.cpio.gz, features, config) for arch. */
export function guestDir(arch = 'arm64') {
  const d = join(binDir(), 'guest', arch)
  if (!existsSync(d)) throw new Error(`wmd: this build has no ${arch} guest (${d})`)
  return d
}
