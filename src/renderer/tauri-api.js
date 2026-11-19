'use strict';
// Tauri 适配层：把 Rust 命令包装成与原 Electron 版相同的 window.api，界面代码无需关心运行时。
(function () {
  const T = window.__TAURI__;
  if (!T) return; // 浏览器预览时由 preview/mock-api.js 提供 api
  const { invoke, convertFileSrc } = T.core;
  const win = T.window.getCurrentWindow();
  // url：自带 CORS 的本地音频协议（可接入 Web Audio）；altUrl：Tauri 内置资源协议，作为兜底
  const withUrls = (tracks) => {
    if (tracks) for (const t of tracks) { t.url = convertFileSrc(t.path, 'media'); t.altUrl = convertFileSrc(t.path); }
    return tracks;
  };

  // 与 Electron contextBridge 一致：不可配置的全局属性
  Object.defineProperty(window, 'api', {
    configurable: false,
    writable: false,
    enumerable: true,
    value: {
      minimize: () => win.minimize(),
      toggleMax: () => win.toggleMaximize(),
      close: () => win.close(), // 是否缩到托盘由后端根据设置决定
      hide: () => win.hide(),
      setMini: (on) => invoke('set_mini', { on }),
      exit: () => invoke('app_exit'),

      getLibrary: async () => {
        const d = await invoke('lib_get');
        withUrls(d.tracks);
        return d;
      },
      scan: async () => withUrls(await invoke('lib_scan')),
      addFolders: () => invoke('folders_add'),
      removeFolder: async (path) => {
        const r = await invoke('folders_remove', { path });
        withUrls(r.tracks);
        return r;
      },
      toggleFolder: (path, enabled) => invoke('folders_toggle', { path, enabled }),
      patch: (patch) => invoke('state_patch', { patch }),

      getCover: (path, size) => invoke('cover_get', { path, size: size || 300 }),
      getLyrics: (path) => invoke('lyrics_get', { path }),
      showInFolder: (path) => invoke('show_in_folder', { path }),
      played: (id) => invoke('track_played', { id }),
      setTrayTooltip: (text) => invoke('set_tray_tooltip', { text }),
      version: () => T.app.getVersion(),
      updateCheck: () => invoke('update_check'),
      updateInstall: (url) => invoke('update_install', { url }),

      on: (ch, fn) => {
        if (ch === 'scan:progress') T.event.listen('scan-progress', (e) => fn(e.payload));
        else if (ch === 'tray') T.event.listen('tray-action', (e) => fn(e.payload));
        else if (ch === 'close') T.event.listen('close-requested', () => fn());
        else if (ch === 'update:progress') T.event.listen('update-progress', (e) => fn(e.payload));
        else if (ch === 'win:state') {
          const upd = async () => fn({ maximized: await win.isMaximized() });
          win.onResized(upd);
          upd();
        }
      },
    },
  });
})();
