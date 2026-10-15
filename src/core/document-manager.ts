import {assertDeepAssetBudget,deepAssetWorkingBytes} from './deep-assets'
import {hdrAssetWorkingBytes} from './hdr-assets'
import type {Asset} from './project-io'
import {bakeExternalClipping} from './live-mask-bake'
import {totalmem} from 'node:os'
import {documentPixelBudget} from '../shared/limits'
import { Editor } from './editor'
import {captureLayerClipboard,transformBounds,type LayerClipboard} from './layer-operations'
import {randomUUID} from 'node:crypto'
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
  private assertDeepWorkspaceBudget(extra:Asset[]=[],omitted?:string):void {
    const assets=[...this.documents].filter(([id])=>id!==omitted).flatMap(([,editor])=>editor.retainedAssets()).concat(extra)
    if(assets.some(asset=>asset.bitDepth===16))assertDeepAssetBudget(assets,0,(this.options.pixelBudget??documentPixelBudget(totalmem()))*4)
  }
  private attach(editor: Editor, reuseWelcome = true): EditorState {
    const current = this.documents.get(this.active)?.state()
    const replace = reuseWelcome && this.documents.size===1 && current && !current.modified && !current.projectPath && !current.manifest.layers.length && current.revision === 0
    if (this.documents.size - (replace ? 1 : 0) >= LIMITS.maxDocuments) throw new EditorError('RESOURCE_LIMIT', 'Close a document before opening another. Eight documents may be open.')
    if (this.pixels(editor.retainedAssets(), replace ? this.active : undefined) > (this.options.pixelBudget??documentPixelBudget(totalmem()))) throw new EditorError('RESOURCE_LIMIT', 'Open documents and retained history exceed the available memory budget. Close another document first.')
    this.assertDeepWorkspaceBudget(editor.retainedAssets(),replace?this.active:undefined)
    if (replace) this.documents.delete(this.active)
    this.active = editor.state().sessionId; this.documents.set(this.active, editor)
    return this.state()
  }
  private makeEditor():Editor{const editor=new Editor({...this.options,pixelBudget:()=>this.options.pixelBudget??documentPixelBudget(totalmem()),retainedAssetBaseline:()=>[...this.documents.values()].flatMap(doc=>doc.retainedAssets()),checkAssets:assets=>{this.assertDeepWorkspaceBudget(assets,editor.state().sessionId);if(this.pixels(assets,editor.state().sessionId)>(this.options.pixelBudget??documentPixelBudget(totalmem())))throw new EditorError('RESOURCE_LIMIT','Open documents and history exceed the available workspace raster budget.')}});return editor}
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
    this.assertDeepWorkspaceBudget(replacement.retainedAssets(),sessionId)
    previous.tasks.assertWritable();replacement.adoptReloadIdentity(sessionId,expectedRevision,expectedFingerprint);this.documents.set(sessionId,replacement);return this.state(sessionId)
  }
  importPhotoshopSnapshot(input:{manifest:import('../shared/contracts').Manifest;assets:[string,Asset][];warnings?:string[]},title:string,context:{retainedWorkingBytes?:number;retainedAssets?:Iterable<Asset>}={}):EditorState {
    // The completed worker snapshot remains alive while canonical assets are
    // revalidated. Count both its transferred buffers and the decoder scratch
    // before allocating replacement sources or changing the active document.
    const retainedWorkingBytes=context.retainedWorkingBytes??0
    if(!Number.isSafeInteger(retainedWorkingBytes)||retainedWorkingBytes<0)throw new EditorError('INVALID_ARGUMENT','Invalid Photoshop import retained working budget.')
    const incoming=input.assets.map(([,asset])=>asset),baseline=[...this.documents.values()].flatMap(editor=>editor.retainedAssets()).concat([...(context.retainedAssets??[])])
    if(this.pixels(incoming)>(this.options.pixelBudget??documentPixelBudget(totalmem())))throw new EditorError('RESOURCE_LIMIT','Photoshop import exceeds the available workspace raster budget.')
    const byteBudget=(this.options.pixelBudget??documentPixelBudget(totalmem()))*4
    assertDeepAssetBudget([...baseline,...incoming],retainedWorkingBytes,byteBudget)
    const decodingBytes=incoming.reduce((bytes,asset)=>{
      const source=Buffer.from(asset.bytes.buffer,asset.bytes.byteOffset,asset.bytes.byteLength)
      return bytes+(asset.file.endsWith('.exr')?hdrAssetWorkingBytes(source):deepAssetWorkingBytes(source))
    },0)
    assertDeepAssetBudget([...baseline,...incoming],decodingBytes+retainedWorkingBytes,byteBudget)
    const editor=this.makeEditor(),assets=new Map(input.assets.map(([file,asset])=>[file,makeAsset(file,Buffer.from(asset.bytes),{allow16:input.manifest.version>=12,allowHDR:input.manifest.version>=13})]))
    editor.importDocument(input.manifest,assets,title,input.warnings??[]);return this.attach(editor)
  }
  async openPhotoshop(path:string):Promise<EditorState>{const imported=decodePhotoshop(await readFile(path)),editor=this.makeEditor();editor.importDocument(imported.manifest,imported.assets,basename(path).replace(/\.[^.]+$/,''),imported.warnings);return this.attach(editor)}
  async restore(path: string, title: string): Promise<EditorState> {
    const loaded = await loadProject(path,{retainedAssets:[...this.documents.values()].flatMap(doc=>doc.retainedAssets())}), editor = this.makeEditor()
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
  /** Attach only after a complete copy and its retained-asset budget checks succeed. */
  transferLayersToNew(input:{source:{sessionId:string;documentId:string;expectedRevision:number};layerIds:string[]}):EditorState&{createdIds:Record<string,string>} {
    const source=this.get(input.source.sessionId),state=source.state()
    if(state.manifest.documentID!==input.source.documentId||state.revision!==input.source.expectedRevision)throw new EditorError('REVISION_CONFLICT','The source document changed during the drag. Start a new drag.')
    const snapshot=source.snapshot(),clipboard=captureLayerClipboard(state.manifest,input.layerIds,state.sessionId)
    const baked=bakeExternalClipping(snapshot.manifest,snapshot.assets,clipboard)
    return this.pasteClipboardToNew(baked.metadata,baked.assets)
  }
  pasteClipboardToNew(clipboard:LayerClipboard,assets:Map<string,Asset>,title?:string):EditorState&{createdIds:Record<string,string>} {
    const drawn=clipboard.layers.filter(layer=>!layer.isGroup&&!layer.adjustment&&(layer.imageFile||layer.text)).map(layer=>transformBounds(layer.transform))
    const snap=(value:number)=>Math.abs(value-Math.round(value))<1e-7?Math.round(value):value
    const fit=drawn.length?{x:Math.floor(snap(Math.min(...drawn.map(r=>r.x)))),y:Math.floor(snap(Math.min(...drawn.map(r=>r.y)))),right:Math.ceil(snap(Math.max(...drawn.map(r=>r.x+r.width)))),bottom:Math.ceil(snap(Math.max(...drawn.map(r=>r.y+r.height))))}:undefined
    const width=fit?fit.right-fit.x:clipboard.canvasSize[0],height=fit?fit.bottom-fit.y:clipboard.canvasSize[1]
    if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The fitted layers exceed the new document raster budget.')
    const editor=this.makeEditor();editor.create(width,height,{title:title??this.freeUntitledTitle()})
    // Compensate the existing paste plan's root/multi-layer anchor so every child and independent mask moves by the same fitted delta.
    const pictured=clipboard.layers.filter(layer=>!layer.isGroup),primary=clipboard.layers.find(layer=>layer.id===clipboard.roots[0])!
    const anchor:[number,number]=clipboard.roots.length===1||!pictured.length?[primary.transform.origin[0]+primary.transform.size[0]/2,primary.transform.origin[1]+primary.transform.size[1]/2]:[(Math.min(...pictured.map(layer=>layer.transform.origin[0]))+Math.max(...pictured.map(layer=>layer.transform.origin[0]+layer.transform.size[0])))/2,(Math.min(...pictured.map(layer=>layer.transform.origin[1]))+Math.max(...pictured.map(layer=>layer.transform.origin[1]+layer.transform.size[1])))/2]
    const point:[number,number]|undefined=fit?[anchor[0]+width/2-(fit.x+fit.right)/2,anchor[1]+height/2-(fit.y+fit.bottom)/2]:undefined
    const result=editor.paste({...editor.identity(),idempotencyKey:randomUUID()},clipboard,assets,undefined,point)
    return {...this.attach(editor),createdIds:result.createdIds??{}}
  }
  importImageAssetNew(asset:Asset,name:string,warnings:string[]=[]):EditorState {const editor=this.makeEditor();editor.create(asset.width,asset.height,{title:this.freeUntitledTitle()});editor.importImageAsset(asset,name,warnings);return this.attach(editor)}
  pasteNewCanvas(bytes:Buffer,name='Pasted Image'):EditorState {
    const id=randomUUID().toUpperCase(),file=`${id}.png`,asset=makeAsset(file,bytes,{allow16:true}),editor=this.makeEditor()
    editor.create(asset.width,asset.height,{title:this.freeUntitledTitle()})
    const clipboard:LayerClipboard={version:1,sourceDocumentId:randomUUID().toUpperCase(),canvasSize:[asset.width,asset.height],roots:[id],files:[file],layers:[{id,name,imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[asset.width,asset.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
    editor.paste({...editor.identity(),idempotencyKey:randomUUID()},clipboard,new Map([[file,asset]]))
    return this.attach(editor)
  }
  private freeUntitledTitle():string {const welcome=this.documents.size===1&&this.workspace().documents[0]?.empty;const titles=new Set([...this.documents.values()].filter(editor=>!welcome||editor.state().sessionId!==this.active).map(editor=>editor.state().title));let title='Untitled';for(let number=2;titles.has(title);number++)title=`Untitled ${number}`;return title}
  importPNG(sessionId: string, bytes: Buffer, name: string, warnings: string[] = []): unknown {
    return this.get(sessionId).importPNG(bytes, name, warnings)
  }
}
