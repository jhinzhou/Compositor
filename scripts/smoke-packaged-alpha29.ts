import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [executable, server] = process.argv.slice(2)
if (!executable || !server) throw new Error('Usage: tsx scripts/smoke-packaged-alpha29.ts <app executable> <packaged server.cjs>')
const profile = await mkdtemp(join(tmpdir(), 'compositor-package-alpha29-'))
const connection = join(profile, 'automation.json')
const environment: NodeJS.ProcessEnv = { ...process.env, COMPOSITOR_PROFILE: profile, COMPOSITOR_TEST: '1' }
delete environment.ELECTRON_RUN_AS_NODE
const desktop = spawn(resolve(executable), [], { env: environment, stdio: 'ignore' })
let startupError: Error | undefined
desktop.on('error', error => { startupError = error })
try {
  const deadline = Date.now() + 30_000
  while (true) {
    if (startupError) throw startupError
    if (desktop.exitCode !== null || desktop.signalCode !== null) throw new Error('The packaged desktop exited during startup.')
    try { await access(connection); break } catch { if (Date.now() >= deadline) throw new Error('The packaged desktop did not create its automation connection.'); await delay(100) }
  }
  const validation = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/smoke-packaged-mcp-alpha29.ts'), resolve(executable), resolve(server), connection], { env: process.env, stdio: 'inherit' })
  await new Promise<void>((accept, reject) => {
    validation.once('error', reject)
    validation.once('exit', code => code === 0 ? accept() : reject(new Error(`Packaged MCP validation exited with ${code}.`)))
  })
} finally {
  if (desktop.exitCode === null && desktop.signalCode === null) {
    desktop.kill('SIGTERM')
    await Promise.race([new Promise<void>(accept => desktop.once('exit', () => accept())), delay(3000)])
    if (desktop.exitCode === null && desktop.signalCode === null) desktop.kill('SIGKILL')
  }
  await rm(profile, { recursive: true, force: true })
}
