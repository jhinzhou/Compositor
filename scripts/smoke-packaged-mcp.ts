import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import type { EditorState, EditAction } from '../src/shared/contracts'
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
  const liveState = async (): Promise<EditorState> => {
    const value = await client.callTool({ name: 'document.get_state', arguments: {} })
    assert.notEqual(value.isError, true, JSON.stringify(value))
    return value.structuredContent as EditorState
  }
  const apply = async (action: EditAction): Promise<EditorState> => {
    const before = await liveState()
    const value = await client.callTool({ name: 'document.apply', arguments: {
      sessionId: before.sessionId, documentId: before.manifest.documentID,
      expectedRevision: before.revision, idempotencyKey: randomUUID(), action
    } })
    assert.notEqual(value.isError, true, JSON.stringify(value))
    return liveState()
  }
  const blank = await apply({ type: 'layer.add_blank', name: 'Packaged MCP alpha9' })
  const layerId = blank.manifest.layers.find(layer => layer.name === 'Packaged MCP alpha9')!.id
  const sourceAssets = blank.assets
  const painted = await apply({ type: 'selection.paint', points: [[16,16]], size: 8, hardness: 1, opacity: 1, value: .5, initial: 'empty' })
  assert.deepEqual(painted.assets, sourceAssets, 'Selection painting must not rewrite image assets')
  assert.ok(painted.selection?.shapes.some(shape => shape.raster?.runs.some(run => run[3] === 128)), 'MCP paint retains gray coverage')
  const saved = await apply({ type: 'selection.save_named', name: 'Packaged gray', overwrite: false })
  const channel = saved.manifest.namedSelections!.find(item => item.name === 'Packaged gray')!
  assert.ok(channel.runs.some(run => run[3] === 128))
  await apply({ type: 'selection.fill', value: 0, opacity: 1 })
  const loaded = await apply({ type: 'selection.load_named', name: 'Packaged gray', operation: 'replace' })
  assert.ok(loaded.selection?.shapes.some(shape => shape.raster?.runs.some(run => run[3] === 128)))
  assert.deepEqual(loaded.assets, sourceAssets)
  const masked = await apply({ type: 'layer.mask', layerId, operation: 'reveal' })
  const maskAssets = masked.assets
  const properties = await apply({ type: 'layer.mask_properties', layerId, density: .4, feather: 2 })
  const layer = properties.manifest.layers.find(item => item.id === layerId)!
  assert.equal(layer.maskDensity, .4)
  assert.equal(layer.maskFeather, 2)
  assert.deepEqual(properties.assets, maskAssets, 'Mask properties must preserve the source mask PNG')
  await apply({type:'selection.set',selection:null})
  await apply({type:'layer.fill',layerId,color:[.2,.4,.7,1],target:'image'})
  await apply({type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,24,32],feather:0}]}})
  const edgeBefore=await liveState()
  const refined=await apply({type:'selection.refine_edges',layerId,output:'selection',boundaryRadius:2,sampleRadius:4,guidedRadius:1,region:[0,0,40,40],strokes:[]})
  assert.equal(refined.revision,edgeBefore.revision+1)
  assert.deepEqual(refined.assets,edgeBefore.assets,'Edge selection output preserves source images and mask assets')
  const undo=await client.callTool({name:'history.undo',arguments:{sessionId:refined.sessionId,documentId:refined.manifest.documentID,expectedRevision:refined.revision,idempotencyKey:randomUUID(),transactionId:refined.undoTransactionId}})
  assert.notEqual(undo.isError,true,JSON.stringify(undo))
  const edgeUndone=await liveState();assert.deepEqual(edgeUndone.selection,edgeBefore.selection);assert.deepEqual(edgeUndone.assets,edgeBefore.assets)
  await mkdir('artifacts', { recursive: true })
  const validation = { status: 'PASS', version, platform: process.platform, checks: ['Packaged Electron launches its MCP stdio bundle inside app.asar', 'Twelve tools, protocol v2, live document and real PNG preview are available', 'Packaged task.begin and task.finish execute against the desktop authority', 'Packaged MCP paints and saves/loads gray selection coverage without changing source assets', 'Packaged MCP applies non-destructive mask Density/Feather without rewriting mask PNG', 'Packaged MCP refines edge selection through the real isolated worker and Undo restores coverage without source asset changes'], previewSize: [png.width, png.height] }
  await writeFile('artifacts/packaged-mcp-validation.json', JSON.stringify(validation, null, 2))
  console.log(JSON.stringify(validation, null, 2))
} finally { await client.close() }
