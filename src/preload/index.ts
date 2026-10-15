import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FileDesktopAPI } from '../shared/file-experience'
import type { DesktopAPI, EditorState, PreviewResult, RpcResult } from '../shared/contracts'

const api: FileDesktopAPI = {
  platform: process.platform,
  dropFiles: (files,options) => { const paths = files.slice(0,32).map(file => webUtils.getPathForFile(file)).filter(Boolean); return ipcRenderer.invoke('editor:drop', options?{paths,destination:options.destination}:paths) },
  onAction: callback => {
    const listener = (_event: Electron.IpcRendererEvent, action: string): void => callback(action)
    ipcRenderer.on('editor:action', listener)
    return () => ipcRenderer.removeListener('editor:action', listener)
  },
  request: (method, params) => ipcRenderer.invoke('editor:request', { method, params }),
  onAgent: callback => {const listener=(_event:Electron.IpcRendererEvent,state:unknown)=>callback(state);ipcRenderer.on('agent:state',listener);return()=>ipcRenderer.removeListener('agent:state',listener)},
  onState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: EditorState): void => callback(state)
    ipcRenderer.on('editor:state', listener)
    return () => ipcRenderer.removeListener('editor:state', listener)
  },
  onRender: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<Parameters<DesktopAPI['onRender']>[0]>[0]): void => callback(value)
    ipcRenderer.on('renderer:render', listener)
    return () => ipcRenderer.removeListener('renderer:render', listener)
  },
  renderComplete: (id: string, result: RpcResult<PreviewResult>) => ipcRenderer.send('renderer:complete', { id, result })
}
contextBridge.exposeInMainWorld('compositor', api)
