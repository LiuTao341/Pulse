'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const Store = require('./store');

let mm = null;
try {
  mm = require('music-metadata'); // v7 (CommonJS)
} catch {
  console.warn('[pulse] 未安装 music-metadata，仅根据文件名解析歌曲信息');
}

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.webm']);
const COVER_NAMES = new Set(['cover', 'folder', 'front', 'album', 'albumart']);

let win = null;
let store = null;
let scanning = false;
const coverCache = new Map();     // `${path}|${size}` -> dataURL | null
const dirCoverCache = new Map();  // dir -> Buffer | null

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

// ───────────────────────── 窗口 ─────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#1c1c1c',
    title: 'Pulse',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
}

// ───────────────────────── 扫描 ─────────────────────────
async function walk(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

function splitArtists(list) {
  const out = [];
  for (const a of list) {
    for (const s of String(a).split(/\s*[;；、]\s*|\s+\/\s+/)) {
      const v = s.trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

async function readTrack(file, folder, st, prev) {
  const base = path.basename(file, path.extname(file));
  const t = {
    id: hash(file),
    path: file,
    url: pathToFileURL(file).href,
    folder,
    title: base,
    artists: ['未知艺术家'],
    album: '未知专辑',
    albumArtist: '',
    genres: [],
    year: null,
    trackNo: null,
    discNo: null,
    duration: 0,
    bitrate: 0,
    codec: '',
    size: st.size,
    mtime: st.mtimeMs,
    addedAt: prev ? prev.addedAt : Date.now(),
    playCount: prev ? prev.playCount || 0 : 0,
    lastPlayed: prev ? prev.lastPlayed || 0 : 0,
  };

  // 文件名兜底：“歌手 - 歌名”
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) {
    t.artists = [m[1].trim()];
    t.title = m[2].trim();
  }

  if (mm) {
    try {
      const md = await mm.parseFile(file, { duration: true, skipCovers: true });
      const c = md.common;
      if (c.title) t.title = c.title;
      const artists = c.artists && c.artists.length ? c.artists : c.artist ? [c.artist] : null;
      if (artists) t.artists = splitArtists(artists);
      if (c.album) t.album = c.album;
      if (c.albumartist) t.albumArtist = c.albumartist;
      if (c.genre && c.genre.length) t.genres = splitArtists(c.genre);
      t.year = c.year || null;
      t.trackNo = (c.track && c.track.no) || null;
      t.discNo = (c.disk && c.disk.no) || null;
      t.duration = md.format.duration || 0;
      t.bitrate = md.format.bitrate || 0;
      t.codec = md.format.codec || '';
    } catch (e) {
      console.warn('[pulse] 读取标签失败', file, e.message);
    }
  }
  return t;
}

async function scanLibrary() {
  if (scanning) return null;
  scanning = true;
  try {
    const old = new Map(store.data.tracks.map((t) => [t.path, t]));
    const files = [];
    for (const f of store.data.folders) {
      const list = [];
      await walk(f.path, list);
      for (const p of list) files.push([p, f.path]);
    }
    send('scan:progress', { done: 0, total: files.length });

    const seen = new Set();
    const result = [];
    let done = 0;
    for (const [file, folder] of files) {
      done++;
      if (seen.has(file)) continue;
      seen.add(file);
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      const prev = old.get(file);
      // 增量：大小和修改时间都没变就直接复用
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) result.push({ ...prev, folder });
      else result.push(await readTrack(file, folder, st, prev));
      if (done % 20 === 0 || done === files.length) send('scan:progress', { done, total: files.length });
    }
    store.data.tracks = result;
    store.save();
    return result;
  } finally {
    scanning = false;
  }
}

// ───────────────────────── 封面 / 歌词 ─────────────────────────
async function dirCover(dir) {
  if (dirCoverCache.has(dir)) return dirCoverCache.get(dir);
  let buf = null;
  try {
    const names = await fsp.readdir(dir);
    const hit = names.find((n) => {
      const ext = path.extname(n).toLowerCase();
      return ['.jpg', '.jpeg', '.png'].includes(ext) && COVER_NAMES.has(path.basename(n, path.extname(n)).toLowerCase());
    });
    if (hit) buf = await fsp.readFile(path.join(dir, hit));
  } catch { /* ignore */ }
  dirCoverCache.set(dir, buf);
  return buf;
}

async function getCover(file, size = 300) {
  const key = `${file}|${size}`;
  if (coverCache.has(key)) return coverCache.get(key);
  let buf = null;
  if (mm) {
    try {
      const md = await mm.parseFile(file, { duration: false, skipPostHeaders: true });
      const pics = md.common.picture;
      const pic = pics && (pics.find((p) => /front/i.test(p.type || '')) || pics[0]);
      if (pic) buf = Buffer.from(pic.data);
    } catch { /* ignore */ }
  }
  if (!buf) buf = await dirCover(path.dirname(file));

  let url = null;
  if (buf) {
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) {
      const { width } = img.getSize();
      const out = width > size ? img.resize({ width: size, quality: 'good' }) : img;
      url = 'data:image/jpeg;base64,' + out.toJPEG(86).toString('base64');
    }
  }
  if (coverCache.size > 600) coverCache.delete(coverCache.keys().next().value);
  coverCache.set(key, url);
  return url;
}

function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.slice(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf); // 兼容国内常见的 GBK 编码 lrc
    } catch {
      return buf.toString('latin1');
    }
  }
}

async function getLyrics(file) {
  const base = file.slice(0, file.length - path.extname(file).length);
  for (const cand of [base + '.lrc', base + '.LRC', base + '.txt']) {
    try {
      return decodeText(await fsp.readFile(cand));
    } catch { /* next */ }
  }
  if (mm) {
    try {
      const md = await mm.parseFile(file, { duration: false, skipCovers: true });
      const l = md.common.lyrics;
      if (l && l.length) return l.map((x) => (typeof x === 'string' ? x : x.text || '')).join('\n');
    } catch { /* ignore */ }
  }
  return null;
}

// ───────────────────────── IPC ─────────────────────────
function registerIpc() {
  ipcMain.on('win:minimize', () => win.minimize());
  ipcMain.on('win:toggleMax', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('win:close', () => win.close());

  ipcMain.handle('lib:get', () => store.data);
  ipcMain.handle('lib:scan', () => scanLibrary());

  ipcMain.handle('folders:add', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '添加文件夹到音乐库',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    for (const p of r.filePaths) {
      if (!store.data.folders.some((f) => f.path === p)) store.data.folders.push({ path: p, enabled: true });
    }
    store.save();
    return store.data.folders;
  });

  ipcMain.handle('folders:remove', (_e, p) => {
    store.data.folders = store.data.folders.filter((f) => f.path !== p);
    store.data.tracks = store.data.tracks.filter((t) => t.folder !== p);
    store.save();
    return { folders: store.data.folders, tracks: store.data.tracks };
  });

  ipcMain.handle('folders:toggle', (_e, p, enabled) => {
    const f = store.data.folders.find((x) => x.path === p);
    if (f) f.enabled = !!enabled;
    store.save();
    return store.data.folders;
  });

  ipcMain.handle('state:patch', (_e, obj) => {
    for (const k of ['blacklist', 'playlists']) if (obj[k]) store.data[k] = obj[k];
    if (obj.settings) store.data.settings = { ...store.data.settings, ...obj.settings };
    store.save();
    return true;
  });

  ipcMain.handle('cover:get', (_e, p, size) => getCover(p, size));
  ipcMain.handle('lyrics:get', (_e, p) => getLyrics(p));
  ipcMain.on('shell:show', (_e, p) => shell.showItemInFolder(p));
  ipcMain.on('track:played', (_e, id) => {
    const t = store.data.tracks.find((x) => x.id === id);
    if (t) {
      t.playCount = (t.playCount || 0) + 1;
      t.lastPlayed = Date.now();
      store.save();
    }
  });
}

// ───────────────────────── 生命周期 ─────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    store = new Store(path.join(app.getPath('userData'), 'library.json'));
    registerIpc();
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });

  app.on('before-quit', () => store && store.flush());
  app.on('window-all-closed', () => {
    if (store) store.flush();
    if (process.platform !== 'darwin') app.quit();
  });
}
