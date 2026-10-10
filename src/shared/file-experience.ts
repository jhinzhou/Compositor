import type { DesktopAPI, EditorState, RpcResult } from './contracts'
/** A DOM File is resolved inside preload; arbitrary filesystem path strings are never accepted. */
export interface FileDesktopAPI extends DesktopAPI { dropFiles(files: File[]): Promise<RpcResult<EditorState>> }
