import { contextBridge, ipcRenderer } from 'electron';
import { createClipboardBridge } from './clipboardBridge';
import { createConfigBridge } from './configBridge';

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  platform: process.platform,
  config: createConfigBridge((channel, body) => ipcRenderer.invoke(channel, body)),
  clipboard: createClipboardBridge((channel, text) => ipcRenderer.invoke(channel, text)),
}));
