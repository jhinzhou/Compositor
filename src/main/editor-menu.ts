import type { MenuItemConstructorOptions } from 'electron'
import { FILTER_NAMES, NATIVE_ADJUSTMENT_KINDS } from '../shared/image-filters'
import { normalizeChord } from '../renderer/command-shortcuts'

// Canvas keys must stay in the renderer, where focused fields and modal dialogs
// can consume them. Native Backspace/Delete accelerators bypass that boundary.
export function nativeAccelerator(chord: string | undefined): string | undefined {
  const normalized = chord ? normalizeChord(chord) : undefined
  // F8 is a panel toggle, not a canvas edit. Keep destructive/bare canvas keys
  // renderer-owned while allowing the familiar Info panel function shortcut.
  if (!normalized || normalized!=='f8'&&!normalized.split('+').slice(0, -1).some(key => ['Primary', 'Ctrl', 'Meta', 'Alt'].includes(key))) return
  return normalized.split('+').map(part => ({ Primary: 'CmdOrCtrl', Meta: 'Command', Ctrl: 'Control', space: 'Space', escape: 'Esc' })[part] ?? part).join('+')
}

export function editorMenuTemplate(platform: string, send: (action: string) => void, language: (locale: 'zh-CN' | 'en') => void): MenuItemConstructorOptions[] {
  const item = (label: string, id: string, shortcut?: string): MenuItemConstructorOptions => ({ id, label, accelerator: nativeAccelerator(shortcut), click: () => send(id) })
  const separator: MenuItemConstructorOptions = { type: 'separator' }
  const filter = (kind: keyof typeof FILTER_NAMES) => item(`${FILTER_NAMES[kind]}…`, `filter:${kind}`)
  const adjustments: (keyof typeof FILTER_NAMES)[] = ['levels', 'curves', 'exposure', 'hsl', 'colorBalance', 'blackWhite', 'invert', 'posterize', 'threshold', 'gradientMap']
  const extensionFilters = Object.keys(FILTER_NAMES).filter(kind => ![...adjustments, 'gaussianBlur', 'motionBlur', 'progressiveBlur', 'addNoise', 'cameraRaw', 'lensCorrection'].includes(kind)) as (keyof typeof FILTER_NAMES)[]
  const mac = platform === 'darwin'
  return [
    ...(mac ? [{ label: 'Compositor Electron', submenu: [
      { role: 'about', label: 'About Compositor Electron' }, separator,
      { role: 'services', label: 'Services' }, separator,
      { role: 'hide', label: 'Hide Compositor Electron' }, { role: 'hideOthers', label: 'Hide Others' }, { role: 'unhide', label: 'Show All' }, separator,
      { role: 'quit', label: 'Quit Compositor Electron' }
    ] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      item('New…', 'new', 'Primary+n'), item('Open…', 'openDialog', 'Primary+o'), item('Open Recent…', 'recent-projects'), separator,
      item('Close', 'closeDocument', 'Primary+w'), item('Save', 'saveCurrent', 'Primary+s'), item('Save As…', 'saveDialog', 'Primary+Shift+s'), item('Save a Copy…', 'saveCopyDialog', 'Primary+Alt+s'), separator,
      { label: 'Export', submenu: [item('Export As…', 'export-as'), item('Export PNG…', 'exportDialog'), item('Export PSD…', 'export-psd'), item('Export PSB…', 'export-psb')] }, separator,
      item('Import Images…', 'importDialog'), item('Import Image Folder…', 'importFolderDialog'),
      ...(!mac ? [separator, { role: 'quit', label: 'Quit Compositor Electron' } as MenuItemConstructorOptions] : [])
    ] },
    { label: 'Edit', submenu: [
      item('Undo', 'undo', 'Primary+z'), item('Redo', 'redo', 'Primary+Shift+z'), separator,
      item('Cut', 'cut', 'Primary+x'), item('Copy', 'copy', 'Primary+c'), item('Copy Merged', 'copy-merged', 'Primary+Shift+c'), item('Paste', 'paste', 'Primary+v'), item('Clear', 'delete'), separator,
      item('Search Commands…', 'palette', 'Primary+f'), separator,
      item('Fill…', 'fill', 'Shift+f5'), item('Content-Aware Fill…', 'content-fill'), separator,
      item('Free Transform', 'transform-selection', 'Primary+t'), { label: 'Transform', submenu: [item('Transform / Merge…', 'layer-actions'), item('Free Distort…', 'distort')] }, separator,
      item('Keyboard Shortcuts…', 'shortcuts', 'Primary+Alt+Shift+k')
    ] },
    { label: 'Image', submenu: [
      { label: 'Adjustments', submenu: adjustments.map(filter) }, separator,
      item('Image Size…', 'image-size', 'Primary+Alt+i'), item('Canvas Size…', 'canvas-size', 'Primary+Alt+c'),
      { label: 'Image Rotation', submenu: [item('Rotate Canvas 90°', 'rotate-canvas'), item('Rotate Canvas 90° Counterclockwise', 'rotate-canvas-ccw'), item('Rotate Canvas 180°', 'rotate-canvas-180'), separator, item('Flip Canvas Horizontal', 'flip-canvas'), item('Flip Canvas Vertical', 'flip-canvas-vertical')] },
      item('Crop Tool', 'tool:crop'), item('Trim…', 'trim-canvas')
    ] },
    { label: 'Layer', submenu: [
      { label: 'New', submenu: [item('New Blank Layer…', 'blank', 'Primary+Shift+n'), item('New Group', 'folder', 'Primary+g')] },
      item('Duplicate Layer or Folder', 'duplicate', 'Primary+j'), item('Delete Layer', 'delete-layer'), separator,
      item('Layer Effects…', 'effects'), { label: 'New Adjustment Layer', submenu: Object.entries(NATIVE_ADJUSTMENT_KINDS).map(([kind, label]) => item(`${label}…`, `adjustment:${kind}`)) },
      { label: 'Layer Mask', submenu: [item('Reveal All', 'mask:reveal'), item('Hide All', 'mask:hide'), item('Reveal Selection', 'mask:selection'), separator, item('Disable / Enable Layer Mask', 'mask:toggle'), item('Delete Layer Mask', 'mask:remove')] }, separator,
      item('Ungroup Layers', 'ungroup', 'Primary+Shift+g'), separator,
      item('Merge Layers', 'merge-auto', 'Primary+e'), item('Merge Visible', 'merge-visible', 'Primary+Shift+e'), item('Stamp Visible', 'stamp-visible', 'Primary+Alt+Shift+e'), item('Stamp Selected', 'stamp-selected', 'Primary+Alt+e')
    ] },
    { label: 'Type', submenu: [item('Type Tool', 'tool:text'), item('Apply Text Edit', 'text:commit')] },
    { label: 'Select', submenu: [
      item('Select All', 'select-all', 'Primary+a'), item('Deselect', 'deselect', 'Primary+d'), item('Reselect', 'reselect', 'Primary+Shift+d'), item('Invert selection', 'invert-selection', 'Primary+Shift+i'), separator,
      item('All Layers', 'select-all-layers', 'Primary+Alt+a'), separator,
      item('Color Range…', 'color-range'), item('Select Subject…', 'subject-tools'), item('Select and Mask…', 'edge-refinement'), separator,
      { label: 'Modify', submenu: [item('Smooth…', 'selection-smooth'), item('Border…', 'selection-border'), item('Expand…', 'selection-expand'), item('Contract…', 'selection-contract'), item('Feather…', 'selection-feather', 'Shift+f6')] }, separator,
      item('Edit in Quick Mask Mode', 'quick-mask'), item('Load Selection…', 'load-selection'), item('Save Selection…', 'save-selection')
    ] },
    { label: 'Filter', submenu: [
      item('Repeat Last Filter', 'repeat-filter'), separator, filter('cameraRaw'), filter('lensCorrection'), separator,
      { label: 'Blur', submenu: [filter('gaussianBlur'), filter('motionBlur'), ...('progressiveBlur' in FILTER_NAMES ? [filter('progressiveBlur' as keyof typeof FILTER_NAMES)] : [])] },
      { label: 'Noise', submenu: [filter('addNoise')] },
      { label: 'Compositor Filters', submenu: extensionFilters.map(filter) }
    ] },
    { label: 'View', submenu: [
      item('Zoom In', 'zoom-in', 'Primary+='), item('Zoom Out', 'zoom-out', 'Primary+-'), item('Fit Canvas', 'fit', 'Primary+0'), item('Actual Pixels', 'actual', 'Primary+1'), separator,
      { label: 'Screen Mode', submenu: [item('Canvas Only Fullscreen', 'canvas-only'), { role: 'togglefullscreen', label: 'Toggle Full Screen' }] }, separator,
      { label: 'Show', submenu: [item('Show Controls', 'controls'), item('Grid', 'grid'), item('Guides', 'guides')] }, item('Rulers', 'rulers', 'Primary+r'), item('Snapping', 'snap'),
      { label: 'Guides', submenu: [item('Lock Guides', 'lock-guides'), item('Clear Guides', 'clear-guides')] }, separator,
      item('Rotate View', 'tool:rotate-view'), item('Reset View Rotation', 'reset-view-rotation'), item('Show / Hide Panels', 'toggle-panels'), item('Show / Hide Side Panels', 'toggle-side-panels')
    ] },
    { label: 'Window', submenu: [
      { role: 'minimize', label: 'Minimize' }, { role: 'zoom', label: 'Zoom' }, ...(mac ? [{ role: 'front', label: 'Bring All to Front' } as MenuItemConstructorOptions] : []), separator,
      item('Info', 'info-tools', 'F8'), item('Navigator', 'navigator'), item('Named Selections', 'named-selections'), item('Agent / MCP', 'automation')
    ] },
    { label: 'Help', submenu: [
      { label: 'Compositor Electron {version} · Early Build', enabled: false }, item('MCP Connection', 'automation-help'), separator,
      { label: 'Language', submenu: [
        { id: 'locale:zh-CN', label: '简体中文', type: 'radio', click: () => language('zh-CN') },
        { id: 'locale:en', label: 'English', type: 'radio', click: () => language('en') }
      ] }
    ] }
  ]
}
