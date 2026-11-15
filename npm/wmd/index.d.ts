/** The programs a platform package carries. */
export declare const PROGRAMS: readonly string[]
/** wmd's version (the release tag without the v). */
export declare const version: string
/** The full commit this release was built from. */
export declare const commit: string
/** The guest architecture of this machine's cpu (x64 is amd64). */
export declare function hostGuestArch(arch?: string): 'arm64' | 'amd64'
/** The C library of this Linux; null on another os. */
export declare function hostLibc(
  platform?: string,
  getReport?: () => { header?: { glibcVersionRuntime?: string } } | null,
): 'glibc' | 'musl' | null
/** The platform package's name, e.g. @threadedstack/wmd-darwin-arm64 or @threadedstack/wmd-linux-x64-musl. */
export declare function platformPackage(platform?: string, arch?: string, libc?: 'glibc' | 'musl' | null): string
/** The bin folder of this machine's platform package (or of the given platform's). */
export declare function binDir(platform?: string, arch?: string, libc?: 'glibc' | 'musl' | null): string
/** The path of one program (wmd, wmdd, wmd-run, wmd-relay, wmd-exe-stub, wmd-fixtures-gen, bootlock.sh). */
export declare function binPath(name?: string): string
/** The guest files folder of arch (default: this cpu's): arm64 has Image and Image-4k, amd64 has bzImage. */
export declare function guestDir(arch?: string): string
