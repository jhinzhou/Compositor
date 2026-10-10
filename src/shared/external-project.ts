export interface ExternalProjectStatus { sessionId: string; revision: number; projectPath?: string; modified: boolean; changed: boolean; readable: boolean; fingerprint?: string; error?: string }
export interface ExternalChange extends ExternalProjectStatus { title: string; status: 'changed' | 'unavailable' | 'busy' }
