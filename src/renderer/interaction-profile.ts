import {normalizePlatformChord,type WorkspaceCommand,type ShortcutOverrides} from './command-shortcuts'

export type InteractionProfile = 'photoshop' | 'compositor'
export const PROFILE_STORAGE_KEY = 'compositor.interaction-profile.v1'
export function loadInteractionProfile(storage: Pick<Storage,'getItem'>): InteractionProfile {
  try { return storage.getItem(PROFILE_STORAGE_KEY) === 'compositor' ? 'compositor' : 'photoshop' } catch { return 'photoshop' }
}
// Defaults are separate from user overrides, so switching profiles never destroys a custom binding.
const photoshopKeys: Record<string,string> = {
  'cycle-tool':'', 'cycle-shape':'', 'tool:smear':'', 'tool:rotate-view':'r',
  'tool:frame':'k','tool:pen':'p','tool:path-selection':'a',
  'toggle-panels':'tab', 'toggle-side-panels':'Shift+tab',
  'export-as':'Primary+Alt+Shift+w', 'importDialog':'',
  'merge-auto':'Primary+e', 'merge-visible':'Primary+Shift+e',
  'stamp-selected':'Primary+Alt+e', 'stamp-visible':'Primary+Alt+Shift+e',
  'fill':'Shift+f5', 'selection-feather':'Shift+f6',
  'fill-foreground':'Alt+backspace','fill-background':'Primary+backspace',
  'fill-foreground-forward':'Alt+delete','fill-background-forward':'Primary+delete',
  'image-size':'Primary+Alt+i','canvas-size':'Primary+Alt+c',
  'filter:levels':'Primary+l','filter:curves':'Primary+m','filter:invert':'Primary+i',
  'filter:hsl':'Primary+u','filter:colorBalance':'Primary+b','filter:blackWhite':'Primary+Alt+Shift+b',
  'reselect':'Primary+Shift+d', 'grid':"Primary+'", 'guides':'Primary+;',
  'shortcuts':'Primary+Alt+Shift+k', 'repeat-filter':'Primary+Alt+f',
  ...Object.fromEntries(Array.from({length:10},(_,digit)=>[`flow:${digit}`,`Shift+${digit}`])),
  ...Object.fromEntries(['m','l','w','c','b','e','j','s','g','u','i','o','y','a'].map(key=>[`cycle-group:${key}`,`Shift+${key}`]))
}
export function profileCommands(commands: WorkspaceCommand[], profile: InteractionProfile,overrides:ShortcutOverrides={},platform:'mac'|'other'='other'): WorkspaceCommand[] {
  const explicit=new Set(Object.values(overrides).map(chord=>normalizePlatformChord(chord,platform)).filter(Boolean))
  return commands.map(command => {const shortcut=profile==='photoshop'&&command.id==='repeat-filter'&&platform==='mac'?'Primary+Ctrl+f':profile==='photoshop'&&command.id in photoshopKeys?photoshopKeys[command.id]:command.shortcut
    return {...command,shortcut:!Object.hasOwn(overrides,command.id)&&shortcut&&explicit.has(normalizePlatformChord(shortcut,platform))?'':shortcut}
  })
}
export function thumbnailSelectionOperation(event: Pick<MouseEvent,'altKey'|'shiftKey'>): 'replace'|'add'|'subtract'|'intersect' {
  return event.altKey && event.shiftKey ? 'intersect' : event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace'
}
