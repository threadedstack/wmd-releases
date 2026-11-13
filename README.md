# wmd-releases

Release builds of [wmd](https://github.com/threadedstack/wmd), the Docker Engine API compatible daemon and CLI that runs each container as a Linux guest inside WebAssembly. Builds are for macOS on Apple silicon (arm64).

## Install

With Homebrew:

```sh
brew tap threadedstack/wmd
brew install wmd
```

On Homebrew 7 and later, run `brew trust threadedstack/wmd` once after `brew tap`: newer Homebrew loads a third-party tap only after you trust it. Older Homebrew has no `brew trust` command and does not need it.

Or with the install script, into `~/.wmd/bin`:

```sh
curl -fsSL https://github.com/threadedstack/wmd-releases/releases/latest/download/install.sh | sh
```

Or with npm (the same files, as packages; npm installs the macOS arm64 build on a Mac with Apple silicon):

```sh
npm install @threadedstack/wmd        # the wmd, wmdd and wmd-relay commands; binPath(), guestDir() for scripts
npm install @threadedstack/wmd-web    # the browser host: src/boot.js, the guest, wmdpack.wasm, the relay
```

Every release is published to npm by this repository's `npm` workflow (`.github/workflows/npm.yml`) once the release is published, with provenance.

Then run `wmd setup` once to start the daemon at login and add a `wmd` docker context.

## What a release holds

Every release is built by wmd's `scripts/release.sh` from one tagged commit of threadedstack/wmd. The release notes name the full commit (a line `commit: <sha>`), so a checkout pinned to a commit can find its release.

| file | what it is |
| --- | --- |
| `wmd`, `wmdd` | the CLI and the daemon |
| `wmd-run` | the wasm host each container runs in |
| `wmd-exe-stub` | the stub `wmd image export --format exe` builds on |
| `wmd-relay` | the network relay for guests in a browser page |
| `vm.wasm`, `Image`, `Image-4k`, `initramfs.cpio.gz`, `features` | the arm64 guest: the vm, the kernels, the container initramfs and its feature list |
| `wmdpack.wasm` | the in-page image layer converter (its sha256 is in the notes) |
| `wmd-web-<version>.tgz` | the wmd-web browser package, with the guest files inside |
| `install.sh` | the install script: it checks every file against `SHA256SUMS.txt` before installing |
| `wmd.rb` | the Homebrew formula of this release (also `Formula/wmd.rb` of [threadedstack/homebrew-wmd](https://github.com/threadedstack/homebrew-wmd)) |
| `SHA256SUMS.txt` | the sha256 of every other file |

The binaries are not signed with a Developer ID and are not notarized. Check a download with `shasum -a 256 -c SHA256SUMS.txt`.
