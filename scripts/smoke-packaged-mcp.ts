import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import type { EditorState } from '../src/shared/contracts'
const [command, server, connection] = process.argv.slice(2)
const version = (JSON.parse(await readFile('package.json', 'utf8')) as { version: string }).version
if (!command || !server || !connection) throw new Error('Usage: tsx scripts/smoke-packaged-mcp.ts <app executable> <packaged server.cjs> <automation.json>')
const client = new Client({ name: 'packaged-mcp-check', version: '0.1.0' })
const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
const transport = new StdioClientTransport({ command, args: [server, '--connection', connection], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' })
transport.stderr?.on('data', data => process.stderr.write(data))
try {
  await client.connect(transport)
  assert.equal((await client.listTools()).tools.length, 12)
  const capabilities = await client.callTool({ name: 'app.get_capabilities', arguments: {} })
  assert.notEqual(capabilities.isError, true, JSON.stringify(capabilities))
  assert.equal((capabilities.structuredContent as { version: string; protocolVersion: number }).version, version)
  assert.equal((capabilities.structuredContent as { protocolVersion: number }).protocolVersion, 2)
  const response = await client.callTool({ name: 'document.get_state', arguments: {} })
  assert.notEqual(response.isError, true, JSON.stringify(response))
  const state = response.structuredContent as EditorState
  const result = await client.callTool({ name: 'document.preview', arguments: { sessionId: state.sessionId, expectedRevision: state.revision, maxDimension: 512 } })
  assert.notEqual(result.isError, true, JSON.stringify(result))
  const image = (result.content as { type: string; data?: string }[]).find(item => item.type === 'image')!
  const png = PNG.sync.read(Buffer.from(image.data!, 'base64'))
  assert.ok(png.width > 0 && png.height > 0)
  const began = await client.callTool({ name: 'task.begin', arguments: { sessionId: state.sessionId, documentId: state.manifest.documentID, expectedRevision: state.revision, idempotencyKey: randomUUID(), label: 'Packaged task lifecycle' } })
  assert.notEqual(began.isError, true, JSON.stringify(began))
  const taskId = (began.structuredContent as { taskId: string }).taskId
  const finished = await client.callTool({ name: 'task.finish', arguments: { sessionId: state.sessionId, documentId: state.manifest.documentID, taskId, idempotencyKey: randomUUID(), state: 'completed' } })
  assert.equal((finished.structuredContent as { state: string }).state, 'completed')
  await mkdir('artifacts', { recursive: true })
  const validation = { status: 'PASS', version, platform: process.platform, checks: ['Packaged Electron launches its MCP stdio bundle inside app.asar', 'Twelve tools, protocol v2, live document and real PNG preview are available', 'Packaged task.begin and task.finish execute against the desktop authority'], previewSize: [png.width, png.height] }
  await writeFile('artifacts/packaged-mcp-validation.json', JSON.stringify(validation, null, 2))
  console.log(JSON.stringify(validation, null, 2))
} finally { await client.close() }
