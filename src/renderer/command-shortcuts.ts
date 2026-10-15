export type WorkspaceCommand = { id: string; title: string; category?: string; description?: string; keywords?: string[]; shortcut?: string; enabled?: boolean }
export type ShortcutOverrides = Record<string, string>
export type ShortcutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const SHORTCUT_STORAGE_KEY = 'compositor.shortcuts.v1'
export type ShortcutPlatform = 'mac' | 'other'
export type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'code' | 'isComposing'>>
const modifiers = ['Primary', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const
export function normalizeChord(chord: string): string | undefined {
  const parts = chord.trim().split('+').map(part => part.trim()), key = parts.pop()?.toLowerCase()
  if (!key || !(/^[^\p{C}\s]$/u.test(key) || ['space', 'enter', 'escape', 'backspace', 'delete', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'].includes(key) || /^f([1-9]|1[0-9]|2[0-4])$/.test(key))) return undefined
  const aliases: Record<string, string> = { primary: 'Primary', cmdorctrl: 'Primary', ctrl: 'Ctrl', control: 'Ctrl', meta: 'Meta', cmd: 'Meta', command: 'Meta', alt: 'Alt', option: 'Alt', shift: 'Shift' }
  const normalized = parts.map(part => aliases[part.toLowerCase()])
  if (normalized.some(part => !part) || new Set(normalized).size !== normalized.length) return undefined
  return [...modifiers.filter(modifier => normalized.includes(modifier)), key].join('+')
}
/** Collapse an explicit Command/Control alias to the platform's primary modifier. */
export function normalizePlatformChord(chord: string, platform?: ShortcutPlatform): string | undefined {
  const normalized = normalizeChord(chord)
  if (!normalized || !platform) return normalized
  const parts = normalized.split('+'), key = parts.pop()!
  const result = parts.map(part => part === (platform === 'mac' ? 'Meta' : 'Ctrl') ? 'Primary' : part)
  if (new Set(result).size !== result.length) return undefined
  return [...modifiers.filter(modifier => result.includes(modifier)), key].join('+')
}
export function eventChord(event: ShortcutKeyEvent, platform: ShortcutPlatform): string | undefined {
  if (event.isComposing || ['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return undefined
  const result: string[] = []
  if (platform === 'mac' ? event.metaKey : event.ctrlKey) result.push('Primary')
  if (platform === 'mac' && event.ctrlKey) result.push('Ctrl')
  if (platform !== 'mac' && event.metaKey) result.push('Meta')
  if (event.altKey) result.push('Alt')
  if (event.shiftKey) result.push('Shift')
  // Shift punctuation uses the underlying key; macOS Option may report a composed
  // character (e.g. Option+B => ∫), so recover its physical key when available.
  const punctuation: Record<string, string> = {'+':'=', '_':'-', '{':'[', '}':']', '!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0', ':':';', '"':"'", '?':'/', '~':'`', '|':'\\', '<':',', '>':'.'}
  const physical: Record<string, string> = {Equal:'=',Minus:'-',BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Backquote:'`',Backslash:'\\',Slash:'/',Comma:',',Period:'.'}
  let key = event.key === ' ' ? 'space' : punctuation[event.key] ?? event.key.toLowerCase()
  if (platform === 'mac' && event.altKey && event.code) {
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase()
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5)
    else key = physical[event.code] ?? key
  }
  return normalizeChord([...result, key].join('+'))
}
export function shortcutFor(command: WorkspaceCommand, overrides: ShortcutOverrides = {}, platform?: ShortcutPlatform): string | undefined {
  const chord = Object.hasOwn(overrides, command.id) ? overrides[command.id] : command.shortcut
  return chord ? normalizePlatformChord(chord, platform) : undefined
}
function chordProblem(command: WorkspaceCommand, raw: string | undefined, platform?: ShortcutPlatform): string | undefined {
  if (!raw) return undefined
  const chord = normalizePlatformChord(raw, platform)
  if (!chord) return `Invalid shortcut for ${command.title}.`
  if (command.id.startsWith('text:') && !chord.split('+').some(part => ['Primary','Ctrl','Meta','Alt'].includes(part))) return `Invalid shortcut for ${command.title}.`
  const reserved = ['Primary+q', ...(platform === 'mac' ? ['Primary+,','Primary+Alt+m'] : platform === 'other' ? ['Alt+f4'] : [])]
  if (reserved.includes(chord)) return `${command.title} uses a reserved system shortcut.`
}
export function shortcutProblem(commands: WorkspaceCommand[], overrides: ShortcutOverrides, platform?: ShortcutPlatform): string | undefined {
  const used = new Map<string, string>()
  for (const command of commands) {
    const raw = Object.hasOwn(overrides, command.id) ? overrides[command.id] : command.shortcut
    const problem = chordProblem(command, raw, platform)
    if (problem) return problem
    const chord = shortcutFor(command, overrides, platform)
    if (!chord) continue
    const existing = used.get(chord)
    if (existing) return `${command.title} and ${existing} use the same shortcut.`
    used.set(chord, command.title)
  }
}
export function commandForKey(commands: WorkspaceCommand[], overrides: ShortcutOverrides, event: ShortcutKeyEvent, platform: ShortcutPlatform): WorkspaceCommand | undefined {
  const chord = eventChord(event, platform)
  return chord ? commands.find(command => command.enabled !== false && shortcutFor(command, overrides, platform) === chord) : undefined
}
export function searchCommands(commands: WorkspaceCommand[], query: string): WorkspaceCommand[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...commands]
  return commands.map((command, index) => {
    const title = command.title.toLocaleLowerCase(), corpus = [title, command.category, command.description, ...(command.keywords ?? [])].filter(Boolean).join(' ').toLocaleLowerCase()
    if (!terms.every(term => corpus.includes(term))) return undefined
    const score = terms.reduce((total, term) => total + (title === term ? 100 : title.startsWith(term) ? 30 : title.includes(term) ? 10 : 1), 0)
    return { command, score, index }
  }).filter((item): item is { command: WorkspaceCommand; score: number; index: number } => !!item).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.command)
}
export function loadShortcuts(storage: ShortcutStorage, commands: WorkspaceCommand[], platform?: ShortcutPlatform): ShortcutOverrides {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const known = new Map(commands.map(command => [command.id, command])), overrides: ShortcutOverrides = {}, used = new Set<string>()
    // Invalid, removed and colliding entries are isolated. Keep a stable winner for
    // duplicate custom keys while preserving explicit clears and valid key swaps.
    for (const [id, value] of Object.entries(parsed).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const command = known.get(id)
      if (!command || typeof value !== 'string' || value.length > 100 || chordProblem(command, value, platform)) continue
      const chord = value ? normalizePlatformChord(value, platform)! : ''
      if (chord && used.has(chord)) continue
      overrides[id] = chord
      if (chord) used.add(chord)
    }
    // Removing an override can re-enable a default; resolve those dependencies
    // without wiping unrelated assignments. An explicit clear always stays clear.
    let changed: boolean
    do {
      changed = false
      const defaults = new Set(commands.filter(command => !Object.hasOwn(overrides, command.id)).map(command => shortcutFor(command, {}, platform)).filter(Boolean))
      for (const [id, chord] of Object.entries(overrides)) if (chord && defaults.has(chord)) { delete overrides[id]; changed = true }
    } while (changed)
    return overrides
  } catch { return {} }
}
export function saveShortcuts(storage: ShortcutStorage, commands: WorkspaceCommand[], overrides: ShortcutOverrides, platform?: ShortcutPlatform): void {
  const problem = shortcutProblem(commands, overrides, platform)
  if (problem) throw new Error(problem)
  const known = new Set(commands.map(command => command.id)), result: ShortcutOverrides = {}
  for (const [id, value] of Object.entries(overrides)) if (known.has(id)) result[id] = value ? normalizePlatformChord(value, platform)! : ''
  storage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(result))
}
export function shortcutLabel(chord: string | undefined, platform: 'mac' | 'other'): string {
  if (!chord) return '—'
  return chord.split('+').map(part => ({ Primary: platform === 'mac' ? '⌘' : 'Ctrl', Ctrl: platform === 'mac' ? '⌃' : 'Ctrl', Meta: platform === 'mac' ? '⌘' : 'Win', Alt: platform === 'mac' ? '⌥' : 'Alt', Shift: platform === 'mac' ? '⇧' : 'Shift', space: 'Space', escape: 'Esc' })[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join(platform === 'mac' ? '' : '+')
}
