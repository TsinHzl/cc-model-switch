import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { createChatBridge } from './chatBridge';
import { createClipboardBridge } from './clipboardBridge';
import { createConfigBridge } from './configBridge';

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  platform: process.platform,
  config: createConfigBridge((channel, body) => ipcRenderer.invoke(channel, body)),
  clipboard: createClipboardBridge((channel, text) => ipcRenderer.invoke(channel, text)),
  // 只订阅固定事件通道；不暴露 ipcRenderer 本体或通用 on。
  chat: createChatBridge(
    (channel, body) => ipcRenderer.invoke(channel, body),
    (channel, listener) => {
      const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
  ),
}));
