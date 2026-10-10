export class EditorError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message) }
}
