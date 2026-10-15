/** Tool variants with real alpha.24 command routes. A shared letter does not imply algorithm parity. */
export type ToolGroupId = 'M' | 'L' | 'W' | 'C' | 'J' | 'I' | 'E' | 'B' | 'G' | 'O' | 'Y' | 'K' | 'P' | 'A'
export interface ToolGroupEntry {
  readonly id: string
  readonly label: string
  readonly tool: 'frame' | 'pen' | 'path-selection' | 'direct-selection' | 'mixer-brush' | 'dodge' | 'burn' | 'sponge' | 'history-brush' | 'art-history-brush' | 'brush' | 'pencil' | 'gradient' | 'paint-bucket' | 'marquee' | 'selection-brush' | 'lasso' | 'object' | 'magic' | 'crop' | 'heal' | 'eyedropper' | 'quick-selection' | 'patch' | 'color-sampler' | 'ruler' | 'remove' | 'content-move' | 'red-eye' | 'eraser' | 'background-eraser' | 'magic-eraser'
  readonly ellipseSelection?: boolean
  readonly marqueeAxis?: 'area' | 'row' | 'column'
  readonly lassoMode?: 'freehand' | 'polygon' | 'magnetic'
  readonly cropMode?: 'crop' | 'straighten' | 'perspective'
  readonly retouchMode?: 'spot-heal' | 'heal'
}
export interface ToolGroup { readonly id: ToolGroupId; readonly entries: readonly ToolGroupEntry[] }
export const TOOL_GROUPS: readonly ToolGroup[] = Object.freeze([
  {id:'M',entries:[{id:'rectangle',label:'Rectangular Marquee',tool:'marquee',ellipseSelection:false,marqueeAxis:'area'},{id:'ellipse',label:'Elliptical Marquee',tool:'marquee',ellipseSelection:true,marqueeAxis:'area'},{id:'single-row',label:'Single Row Marquee',tool:'marquee',marqueeAxis:'row'},{id:'single-column',label:'Single Column Marquee',tool:'marquee',marqueeAxis:'column'}]},
  {id:'L',entries:[{id:'selection-brush',label:'Selection Brush',tool:'selection-brush'},{id:'lasso-freehand',label:'Lasso',tool:'lasso',lassoMode:'freehand'},{id:'lasso-polygon',label:'Polygonal Lasso',tool:'lasso',lassoMode:'polygon'},{id:'lasso-magnetic',label:'Magnetic Lasso',tool:'lasso',lassoMode:'magnetic'}]},
  {id:'W',entries:[{id:'object',label:'Object Selection',tool:'object'},{id:'quick',label:'Quick Selection',tool:'quick-selection'},{id:'magic',label:'Wand',tool:'magic'}]},
  {id:'C',entries:[{id:'crop',label:'Crop',tool:'crop',cropMode:'crop'},{id:'perspective-crop',label:'Perspective Crop',tool:'crop',cropMode:'perspective'},{id:'straighten',label:'Straighten',tool:'crop',cropMode:'straighten'}]},
  {id:'J',entries:[{id:'spot-heal',label:'Spot Healing Brush',tool:'heal',retouchMode:'spot-heal'},{id:'remove',label:'Remove Tool',tool:'remove'},{id:'heal',label:'Healing Brush',tool:'heal',retouchMode:'heal'},{id:'patch',label:'Patch Tool',tool:'patch'},{id:'content-move',label:'Content-Aware Move Tool',tool:'content-move'},{id:'red-eye',label:'Red Eye Tool',tool:'red-eye'}]},
  {id:'K',entries:[{id:'frame',label:'Frame Tool',tool:'frame'}]},
  {id:'P',entries:[{id:'pen',label:'Pen Tool',tool:'pen'}]},
  {id:'A',entries:[{id:'path-selection',label:'Path Selection Tool',tool:'path-selection'},{id:'direct-selection',label:'Direct Selection Tool',tool:'direct-selection'}]},
  {id:'O',entries:[{id:'dodge',label:'Dodge Tool',tool:'dodge'},{id:'burn',label:'Burn Tool',tool:'burn'},{id:'sponge',label:'Sponge Tool',tool:'sponge'}]},
  {id:'Y',entries:[{id:'history-brush',label:'History Brush Tool',tool:'history-brush'},{id:'art-history-brush',label:'Art History Brush Tool',tool:'art-history-brush'}]},
  {id:'B',entries:[{id:'brush',label:'Brush Tool',tool:'brush'},{id:'pencil',label:'Pencil Tool',tool:'pencil'},{id:'mixer-brush',label:'Mixer Brush Tool',tool:'mixer-brush'}]},
  {id:'G',entries:[{id:'gradient',label:'Gradient Tool',tool:'gradient'},{id:'paint-bucket',label:'Paint Bucket Tool',tool:'paint-bucket'}]},
  {id:'E',entries:[{id:'eraser',label:'Eraser Tool',tool:'eraser'},{id:'background-eraser',label:'Background Eraser Tool',tool:'background-eraser'},{id:'magic-eraser',label:'Magic Eraser Tool',tool:'magic-eraser'}]},
  {id:'I',entries:[{id:'eyedropper',label:'Eyedropper',tool:'eyedropper'},{id:'color-sampler',label:'Color Sampler',tool:'color-sampler'},{id:'ruler',label:'Ruler Tool',tool:'ruler'}]}
].map(group=>Object.freeze({...group,entries:Object.freeze(group.entries.map(entry=>Object.freeze(entry)))})) as ToolGroup[])

export function toolGroup(id: ToolGroupId): ToolGroup { return TOOL_GROUPS.find(group=>group.id===id)! }
export function toolGroupForTool(tool: string): ToolGroup | undefined { return TOOL_GROUPS.find(group=>group.entries.some(entry=>entry.tool===tool)) }
export interface ToolGroupState { tool: string; marqueeAxis?:string; ellipseSelection?: boolean; lassoMode?: string; cropMode?: string; retouchMode?: string }
export function selectedToolGroupEntry(id: ToolGroupId, state: ToolGroupState): ToolGroupEntry | undefined {
  return toolGroup(id).entries.find(entry=>entry.tool===state.tool
    && (entry.marqueeAxis===undefined||entry.marqueeAxis===(state.marqueeAxis??'area'))
    && (entry.ellipseSelection===undefined||entry.ellipseSelection===(state.ellipseSelection??false))
    && (entry.lassoMode===undefined||entry.lassoMode===(state.lassoMode??'freehand'))
    && (entry.cropMode===undefined||entry.cropMode===(state.cropMode??'crop'))
    && (entry.retouchMode===undefined||entry.retouchMode===(state.retouchMode??'spot-heal')))
}
/** The rail remembers a group's displayed tool even while another group is
 * active. Never accept an entry object from a different or removed group. */
export function displayedToolGroupEntry(id:ToolGroupId,state:ToolGroupState,remembered?:Pick<ToolGroupEntry,'id'>):ToolGroupEntry {
 const group=toolGroup(id)
 return selectedToolGroupEntry(id,state)??group.entries.find(entry=>entry.id===remembered?.id)??group.entries[0]
}
export function toolGroupIconProps(entry:ToolGroupEntry):{tool:ToolGroupEntry['tool'];variant:string}{return {tool:entry.tool,variant:entry.id}}
export interface ToolGroupAnchor { left: number; top: number; width: number; height: number }
/** Anchor uses viewport coordinates, e.g. trigger.getBoundingClientRect(). */
export function toolGroupMenuPosition(anchor: ToolGroupAnchor, menu: {width:number;height:number}, viewport: {width:number;height:number}): {left:number;top:number} {
  const finite=(value:number)=>Number.isFinite(value)?value:0
  const padding=6,width=Math.max(0,finite(viewport.width)),height=Math.max(0,finite(viewport.height))
  return {left:Math.max(padding,Math.min(finite(anchor.left)+Math.max(0,finite(anchor.width))+padding,Math.max(padding,width-finite(menu.width)-padding))),
    top:Math.max(padding,Math.min(finite(anchor.top),Math.max(padding,height-finite(menu.height)-padding)))}
}
