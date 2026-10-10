import {bakeExternalClipping} from './live-mask-bake'
import {totalmem} from 'node:os'
import {documentPixelBudget} from '../shared/limits'
import { Editor } from './editor'
import {captureLayerClipboard} from './layer-operations'
import {decodePhotoshop} from './photoshop-io'
import {readFile} from 'node:fs/promises'
import {basename} from 'node:path'
import { loadProject, makeAsset } from './project-io'
import { EditorError, LIMITS, type AssetInfo, type EditorState, type WorkspaceState } from '../shared/contracts'

// Open-instance session IDs, not project IDs, route every operation.
export class DocumentManager {
  private documents = new Map<string, Editor>()
  private active!: string
  constructor(private options: { journalDirectory?: string; pixelBudget?:number } = {}) { this.newDocument() }
  get(sessionId = this.active): Editor {
    const editor = this.documents.get(sessionId)
    if (!editor) throw new EditorError('SESSION_EXPIRED', 'This document was closed. Read the list of open documents.')
    return editor
  }
  state(sessionId = this.active): EditorState { return { ...this.get(sessionId).state(), workspace: this.workspace() } }
  workspace(): WorkspaceState {
    return { activeSessionId: this.active, retainedPixels: this.pixels(), documents: [...this.documents].map(([sessionId, editor]) => {
      const state = editor.state()
      return { sessionId, documentId: state.manifest.documentID, revision: state.revision, title: state.title,
        modified: state.modified, projectPath: state.projectPath, width: state.manifest.width, height: state.manifest.height,
        empty: !state.modified && !state.projectPath && !state.manifest.layers.length && state.revision === 0 }
    }) }
  }
  private pixels(extra: AssetInfo[] = [], omitted?: string): number {
    const assets = new Map<string, AssetInfo>()
    for (const [id, editor] of this.documents) if (id !== omitted) for (const asset of editor.retainedAssets()) assets.set(asset.hash, asset)
    for (const asset of extra) assets.set(asset.hash, asset)
    return [...assets.values()].reduce((sum, asset) => sum + asset.width * asset.height, 0)
  }
  private attach(editor: Editor, reuseWelcome = true): EditorState {
    const current = this.documents.get(this.active)?.state()
    const replace = reuseWelcome && this.documents.size===1 && current && !current.modified && !current.projectPath && !current.manifest.layers.length && current.revision === 0
    if (this.documents.size - (replace ? 1 : 0) >= LIMITS.maxDocuments) throw new EditorError('RESOURCE_LIMIT', 'Close a document before opening another. Eight documents may be open.')
    if (this.pixels(editor.retainedAssets(), replace ? this.active : undefined) > (this.options.pixelBudget??documentPixelBudget(totalmem()))) throw new EditorError('RESOURCE_LIMIT', 'Open documents and retained history exceed the available memory budget. Close another document first.')
    if (replace) this.documents.delete(this.active)
    this.active = editor.state().sessionId; this.documents.set(this.active, editor)
    return this.state()
  }
  private makeEditor():Editor{const editor=new Editor({...this.options,pixelBudget:()=>this.options.pixelBudget??documentPixelBudget(totalmem()),checkAssets:assets=>{if(this.pixels(assets,editor.state().sessionId)>(this.options.pixelBudget??documentPixelBudget(totalmem())))throw new EditorError('RESOURCE_LIMIT','Open documents and history exceed the available workspace raster budget.')}});return editor}
  newDocument(): EditorState { const titles=new Set([...this.documents.values()].map(editor=>editor.state().title));let title='Untitled';for(let number=2;titles.has(title);number++)title=`Untitled ${number}`;const editor=this.makeEditor();editor.create(1920,1080,{title});return this.attach(editor,false) }
  create(width: number, height: number, sessionId = this.active): EditorState {
    const original = this.get(sessionId).state()
    if (original.modified || original.projectPath || original.manifest.layers.length || original.revision !== 0) throw new EditorError('DOCUMENT_CHANGED', 'Create a new tab before creating another canvas.')
    const editor = this.makeEditor(); editor.create(width, height, { modified: true,title:original.title })
    editor.apply({ ...editor.identity(), action: { type: 'layer.add_blank', name: 'Layer 1' } })
    this.documents.delete(sessionId)
    this.active = editor.state().sessionId; this.documents.set(this.active, editor)
    return this.state()
  }
  async open(path: string): Promise<EditorState> { const editor = this.makeEditor(); await editor.open(path); return this.attach(editor) }
  async reload(sessionId:string,expectedRevision:number,expectedFingerprint?:string):Promise<EditorState>{
    const previous=this.get(sessionId),before=previous.state();previous.tasks.assertWritable();if(before.revision!==expectedRevision)throw new EditorError('REVISION_CONFLICT','The document changed before reload. Review the current revision.')
    if(!before.projectPath)throw new EditorError('SAVE_AS_REQUIRED','Only a saved project can be reloaded.')
    const replacement=this.makeEditor();await replacement.open(before.projectPath)
    if(this.get(sessionId)!==previous||previous.state().revision!==expectedRevision||previous.state().projectPath!==before.projectPath)throw new EditorError('REVISION_CONFLICT','The document changed while loading its external version; current edits were kept.')
    if(this.pixels(replacement.retainedAssets(),sessionId)>(this.options.pixelBudget??documentPixelBudget(totalmem())))throw new EditorError('RESOURCE_LIMIT','Reload would exceed the available workspace raster budget.')
    previous.tasks.assertWritable();replacement.adoptReloadIdentity(sessionId,expectedRevision,expectedFingerprint);this.documents.set(sessionId,replacement);return this.state(sessionId)
  }
  importPhotoshopSnapshot(input:{manifest:import('../shared/contracts').Manifest;assets:[string,import('./project-io').Asset][];warnings?:string[]},title:string):EditorState {const editor=this.makeEditor(),assets=new Map(input.assets.map(([file,asset])=>[file,makeAsset(file,Buffer.from(asset.bytes))]));editor.importDocument(input.manifest,assets,title,input.warnings??[]);return this.attach(editor)}
  async openPhotoshop(path:string):Promise<EditorState>{const imported=decodePhotoshop(await readFile(path)),editor=this.makeEditor();editor.importDocument(imported.manifest,imported.assets,basename(path).replace(/\.[^.]+$/,''),imported.warnings);return this.attach(editor)}
  async restore(path: string, title: string): Promise<EditorState> {
    const loaded = await loadProject(path), editor = this.makeEditor()
    editor.restore(loaded.manifest, loaded.assets, title)
    return this.attach(editor)
  }
  switch(sessionId: string): EditorState { this.get(sessionId); this.active = sessionId; return this.state() }
  close(sessionId: string): EditorState {
    this.get(sessionId)
    if(this.documents.size===1&&this.workspace().documents[0].empty)return this.state()
    const keys = [...this.documents.keys()], index = keys.indexOf(sessionId)
    this.documents.delete(sessionId)
    if (!this.documents.size) return this.newDocument()
    if (this.active === sessionId) this.active = keys[index + 1] ?? keys[index - 1]
    return this.state()
  }
  transferLayers(input:{source:{sessionId:string;documentId:string;expectedRevision:number};request:{sessionId:string;documentId:string;expectedRevision:number;idempotencyKey:string};layerIds:string[];point?:[number,number]}):unknown {
    const source=this.get(input.source.sessionId),state=source.state(),target=this.get(input.request.sessionId)
    if(source===target)throw new EditorError('INVALID_ARGUMENT','Choose another document for a cross-document copy.')
    if(state.manifest.documentID!==input.source.documentId||state.revision!==input.source.expectedRevision)throw new EditorError('REVISION_CONFLICT','The source document changed during the drag. Start a new drag.')
    const snapshot=source.snapshot(),clipboard=captureLayerClipboard(state.manifest,input.layerIds,state.sessionId)
    const baked=bakeExternalClipping(snapshot.manifest,snapshot.assets,clipboard),result=target.paste(input.request,baked.metadata,baked.assets,undefined,input.point)
    this.active=input.request.sessionId;return result
  }
  importPNG(sessionId: string, bytes: Buffer, name: string, warnings: string[] = []): unknown {
    return this.get(sessionId).importPNG(bytes, name, warnings)
  }
}
