/** The programs a platform package carries. */
export declare const PROGRAMS: readonly string[]
/** wmd's version (the release tag without the v). */
export declare const version: string
/** The full commit this release was built from. */
export declare const commit: string
/** The platform package's name, e.g. @threadedstack/wmd-darwin-arm64. */
export declare function platformPackage(platform?: string, arch?: string): string
/** The bin folder of this machine's platform package. */
export declare function binDir(): string
/** The path of one program (wmd, wmdd, wmd-run, wmd-relay, wmd-exe-stub, wmd-fixtures-gen, bootlock.sh). */
export declare function binPath(name?: string): string
/** The guest files folder (vm.wasm, Image, Image-4k, initramfs.cpio.gz, features, config). */
export declare function guestDir(arch?: string): string
