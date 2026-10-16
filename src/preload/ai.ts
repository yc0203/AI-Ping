import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AiApi } from '../shared/ai';

const on = <T>(channel: string, cb: (value: T) => void) => {
  const fn = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, fn); return () => ipcRenderer.removeListener(channel, fn);
};
const api: AiApi = {
  get: () => ipcRenderer.invoke('ai:get'),
  save: (config, key) => ipcRenderer.invoke('ai:save', config, key),
  begin: action => ipcRenderer.invoke('ai:begin', action),
  selected: rect => ipcRenderer.invoke('ai:selected', rect),
  cancel: () => ipcRenderer.invoke('ai:cancel'),
  openPanel: () => ipcRenderer.invoke('ai:expand'),
  dismiss: () => ipcRenderer.invoke('ai:dismiss'),
  send: text => ipcRenderer.invoke('ai:send', text),
  copy: text => ipcRenderer.invoke('ai:copy', text),
  copyImage: () => ipcRenderer.invoke('ai:copy-image'),
  saveImage: () => ipcRenderer.invoke('ai:save-image'),
  importAsset: kind => ipcRenderer.invoke('ai:import', kind),
  checkCodex: () => ipcRenderer.invoke('ai:codex-check'),
  pickCodex: () => ipcRenderer.invoke('ai:codex-pick'),
  onState: cb => on('ai:state', cb),
  onConfig: cb => on('ai:config', cb),
  onDelta: cb => on('ai:delta', cb),
  onCapture: cb => on('ai:capture', cb),
};
contextBridge.exposeInMainWorld('aiApi', api);
