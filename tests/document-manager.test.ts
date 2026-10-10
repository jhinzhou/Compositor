import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { DocumentManager } from '../src/core/document-manager'
import { EditorError } from '../src/shared/contracts'
const fixture = resolve('fixtures/demo.comp')
const code = (expected: string) => (error: unknown) => error instanceof EditorError && error.code === expected

test('three open instances retain independent revisions, history and document identities', async () => {
  const manager = new DocumentManager()
  const a = await manager.open(fixture), b = await manager.open(fixture), c = manager.newDocument()
  assert.equal(a.manifest.documentID, b.manifest.documentID)
  assert.notEqual(a.sessionId, b.sessionId)
  const editor = manager.get(a.sessionId)
  editor.apply({ ...editor.identity(), action: { type: 'layer.rename', layerId: a.manifest.layers[0].id, name: 'A only' } })
  assert.equal(manager.state(a.sessionId).revision, 1)
  assert.equal(manager.state(b.sessionId).revision, 0)
  assert.equal(manager.state(b.sessionId).manifest.layers[0].name, b.manifest.layers[0].name)
  assert.equal(manager.state().sessionId, c.sessionId)
  manager.switch(a.sessionId)
  assert.equal(manager.state().manifest.layers[0].name, 'A only')
  manager.close(b.sessionId)
  assert.equal(manager.workspace().documents.length, 2)
  assert.throws(() => manager.get(b.sessionId), code('SESSION_EXPIRED'))
  assert.equal(manager.state().sessionId, a.sessionId)
})

test('failed open and maximum tab count leave the active workspace untouched', async () => {
  const manager = new DocumentManager()
  for (let i = 0; i < 8; i++) await manager.open(fixture)
  const before = manager.state()
  await assert.rejects(() => manager.open(fixture), code('RESOURCE_LIMIT'))
  await assert.rejects(() => manager.open('missing.comp'))
  assert.deepEqual(manager.state(), before)
})

test('creating a canvas is one initial blank transaction; closing last tab expires its session', () => {
  const manager = new DocumentManager(), welcome = manager.state()
  assert.equal(welcome.modified, false)
  assert.equal(welcome.workspace?.documents[0].empty, true)
  const created = manager.create(512, 288, welcome.sessionId)
  assert.equal(created.manifest.layers.length, 1)
  assert.equal(created.revision, 1)
  assert.equal(created.modified, true)
  const editor = manager.get(created.sessionId)
  editor.apply({ ...editor.identity(), action: { type: 'layer.delete', layerId: created.manifest.layers[0].id } })
  assert.equal(manager.state().modified, true)
  assert.equal(manager.workspace().documents[0].empty, false)
  assert.throws(() => manager.get(welcome.sessionId), code('SESSION_EXPIRED'))
  assert.throws(() => manager.create(100, 100), code('DOCUMENT_CHANGED'))
  const next = manager.close(created.sessionId)
  assert.equal(next.workspace?.documents.length, 1)
  assert.equal(next.manifest.layers.length, 0)
  assert.equal(next.modified, false)
  assert.notEqual(next.sessionId, created.sessionId)
})

test('upstream d0ec: sole blank tab stays and new tabs use the lowest available Untitled number',()=>{
 const manager=new DocumentManager(),first=manager.state();assert.equal(manager.close(first.sessionId).sessionId,first.sessionId)
 const a=manager.create(10,10,first.sessionId),second=manager.newDocument(),third=manager.newDocument()
 assert.equal(a.title,'Untitled');assert.equal(second.title,'Untitled 2');assert.equal(third.title,'Untitled 3')
 manager.close(second.sessionId);assert.equal(manager.newDocument().title,'Untitled 2')
 for(const doc of [...manager.workspace().documents].filter(doc=>doc.sessionId!==a.sessionId))manager.close(doc.sessionId);manager.close(a.sessionId)
 const last=manager.state();assert.equal(last.title,'Untitled');assert.equal(last.workspace!.documents.length,1);assert.equal(manager.close(last.sessionId).sessionId,last.sessionId)
})
