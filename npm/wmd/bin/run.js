// The wmd, wmdd and wmd-relay commands of @threadedstack/wmd (bin/<name>.js): runs the program of that name from the
// platform package with the same arguments, stdin, stdout and stderr, and ends with its exit code (or its signal).
import { spawn } from 'node:child_process'
import { binPath } from '../index.js'

export function run(name) {
  let file
  try {
    file = binPath(name)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
  const child = spawn(file, process.argv.slice(2), { stdio: 'inherit' })
  // the terminal sends ^C to the whole process group; other signals are passed on
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2']) process.on(sig, () => child.kill(sig))
  process.on('SIGINT', () => {})
  child.on('error', (e) => {
    console.error(`wmd: ${file}: ${e.message}`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal)
      process.kill(process.pid, signal)
    } else process.exit(code ?? 1)
  })
}
