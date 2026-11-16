'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['scan:progress', 'win:state'];

contextBridge.exposeInMainWorld('api', {
  // 窗口
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMax: () => ipcRenderer.send('win:toggleMax'),
  close: () => ipcRenderer.send('win:close'),

  // 音乐库
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  scan: () => ipcRenderer.invoke('lib:scan'),
  addFolders: () => ipcRenderer.invoke('folders:add'),
  removeFolder: (p) => ipcRenderer.invoke('folders:remove', p),
  toggleFolder: (p, enabled) => ipcRenderer.invoke('folders:toggle', p, enabled),

  // 状态（黑名单 / 播放列表 / 设置）
  patch: (obj) => ipcRenderer.invoke('state:patch', obj),

  // 资源
  getCover: (p, size) => ipcRenderer.invoke('cover:get', p, size),
  getLyrics: (p) => ipcRenderer.invoke('lyrics:get', p),
  showInFolder: (p) => ipcRenderer.send('shell:show', p),
  played: (id) => ipcRenderer.send('track:played', id),

  on: (ch, fn) => {
    if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d));
  },
});
