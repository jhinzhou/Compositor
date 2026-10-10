export type WorkspaceCommand = { id: string; title: string; category?: string; description?: string; keywords?: string[]; shortcut?: string; enabled?: boolean }
export type ShortcutOverrides = Record<string, string>
export type ShortcutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const SHORTCUT_STORAGE_KEY = 'compositor.shortcuts.v1'
const modifiers = ['Primary', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const
export function normalizeChord(chord: string): string | undefined {
  const parts = chord.trim().split('+').map(part => part.trim()), key = parts.pop()?.toLowerCase()
  if (!key || !(/^.$/u.test(key) || ['space', 'enter', 'escape', 'backspace', 'delete', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'].includes(key) || /^f([1-9]|1[0-9]|2[0-4])$/.test(key))) return undefined
  const aliases: Record<string, string> = { primary: 'Primary', cmdorctrl: 'Primary', ctrl: 'Ctrl', control: 'Ctrl', meta: 'Meta', cmd: 'Meta', command: 'Meta', alt: 'Alt', option: 'Alt', shift: 'Shift' }
  const normalized = parts.map(part => aliases[part.toLowerCase()])
  if (normalized.some(part => !part) || new Set(normalized).size !== normalized.length) return undefined
  return [...modifiers.filter(modifier => normalized.includes(modifier)), key].join('+')
}
export function eventChord(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, platform: 'mac' | 'other'): string | undefined {
  if (['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return undefined
  const result: string[] = []
  if (platform === 'mac' ? event.metaKey : event.ctrlKey) result.push('Primary')
  if (platform === 'mac' && event.ctrlKey) result.push('Ctrl')
  if (platform !== 'mac' && event.metaKey) result.push('Meta')
  if (event.altKey) result.push('Alt')
  if (event.shiftKey) result.push('Shift')
  // Plus is recorded as '='; Shift+'=' remains portable across native menu accelerators.
  result.push(event.key === ' ' ? 'space' : ({'+' :'=', '_':'-', '{':'[', '}':']'} as Record<string,string>)[event.key] ?? event.key.toLowerCase())
  return normalizeChord(result.join('+'))
}
export function shortcutFor(command: WorkspaceCommand, overrides: ShortcutOverrides = {}): string | undefined {
  const chord = Object.hasOwn(overrides, command.id) ? overrides[command.id] : command.shortcut
  return chord ? normalizeChord(chord) : undefined
}
export function shortcutProblem(commands: WorkspaceCommand[], overrides: ShortcutOverrides): string | undefined {
  const used = new Map<string, string>()
  for (const command of commands) {
    const raw = Object.hasOwn(overrides, command.id) ? overrides[command.id] : command.shortcut
    const chord = shortcutFor(command, overrides)
    if (raw && !chord) return `Invalid shortcut for ${command.title}.`
    if (!chord) continue
    if (['Primary+q'].includes(chord)) return `${command.title} uses a reserved system shortcut.`
    const existing = used.get(chord)
    if (existing) return `${command.title} and ${existing} use the same shortcut.`
    used.set(chord, command.title)
  }
}
export function commandForKey(commands: WorkspaceCommand[], overrides: ShortcutOverrides, event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, platform: 'mac' | 'other'): WorkspaceCommand | undefined {
  const chord = eventChord(event, platform)
  return chord ? commands.find(command => command.enabled !== false && shortcutFor(command, overrides) === chord) : undefined
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
export function loadShortcuts(storage: ShortcutStorage, commands: WorkspaceCommand[]): ShortcutOverrides {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SHORTCUT_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const known = new Set(commands.map(command => command.id)), overrides: ShortcutOverrides = {}
    for (const [id, value] of Object.entries(parsed)) if (known.has(id) && typeof value === 'string' && value.length <= 100 && (!value || normalizeChord(value))) overrides[id] = value ? normalizeChord(value)! : ''
    return shortcutProblem(commands, overrides) ? {} : overrides
  } catch { return {} }
}
export function saveShortcuts(storage: ShortcutStorage, commands: WorkspaceCommand[], overrides: ShortcutOverrides): void {
  const problem = shortcutProblem(commands, overrides)
  if (problem) throw new Error(problem)
  const known = new Set(commands.map(command => command.id)), result: ShortcutOverrides = {}
  for (const [id, value] of Object.entries(overrides)) if (known.has(id)) result[id] = value ? normalizeChord(value)! : ''
  storage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(result))
}
export function shortcutLabel(chord: string | undefined, platform: 'mac' | 'other'): string {
  if (!chord) return '—'
  return chord.split('+').map(part => ({ Primary: platform === 'mac' ? '⌘' : 'Ctrl', Ctrl: platform === 'mac' ? '⌃' : 'Ctrl', Meta: platform === 'mac' ? '⌘' : 'Win', Alt: platform === 'mac' ? '⌥' : 'Alt', Shift: platform === 'mac' ? '⇧' : 'Shift', space: 'Space', escape: 'Esc' })[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join(platform === 'mac' ? '' : '+')
}
