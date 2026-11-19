'use strict';
/* global MediaMetadata, api */
// 注意：不要写 `const api = window.api`。
// contextBridge 把 window.api 定义为不可配置的全局属性，同名的顶层 const 会让整个脚本抛 SyntaxError 而不执行。

// ═════════════════════════ 工具 ═════════════════════════
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
const fmtTotal = (s) => (s >= 3600 ? (s / 3600).toFixed(1) + ' 时' : Math.round(s / 60) + ' 分');
const sum = (list, fn) => list.reduce((a, t) => a + (fn(t) || 0), 0);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sepOf = (p) => (p.includes('\\') ? '\\' : '/');
const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
/** 只滚动 box 自身，把 el 移到中间（scrollIntoView 会连带滚动外层容器，导致整个窗口错位） */
function centerIn(box, el, smooth = false) {
  if (!box || !el) return;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 2 + el.offsetHeight / 2;
  box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}
function groupBy(list, fn) {
  const m = new Map();
  for (const t of list) for (const k of [].concat(fn(t))) { if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return m;
}
function shuffled(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ═════════════════════════ 图标 ═════════════════════════
const ICONS = {
  play: '<path d="M7 4.6v14.8L19 12z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14" stroke-width="2.6"/>',
  prev: '<path d="M6 5v14"/><path d="M18 5.5 9 12l9 6.5z" fill="currentColor"/>',
  next: '<path d="M18 5v14"/><path d="M6 5.5 15 12l-9 6.5z" fill="currentColor"/>',
  shuffle: '<path d="M3 7h3c4.5 0 6.5 10 11 10h4M3 17h3c1.7 0 2.9-1.5 4-3.4M13.9 9.5C15 8 16.2 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/>',
  repeat1: '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/><path d="M11 10.5l1.5-1v5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 10l4 4M21 10l-4 4"/>',
  queue: '<path d="M4 6h16M4 11h16M4 16h8M16 14v6l5-3z"/>',
  settings: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  min: '<path d="M5 12h14"/>',
  max: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<path d="M8 8h11v11H8z"/><path d="M5 16V5h11"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  artist: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  album: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (n, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

// ═════════════════════════ 状态 ═════════════════════════
const S = {
  folders: [], tracks: [], lib: [], byId: new Map(), blacklist: new Map(), settings: {},
  view: 'artists', prevView: 'artists', settingsTab: 'library', sel: {}, search: '',
  ctx: { tracks: [] }, redraw: null, scanning: false,
};

const artistOf = (t) => t.artists.join(' / ');
const albumArtistOf = (t) => t.albumArtist || t.artists[0] || '未知艺术家';
const albumKey = (t) => albumArtistOf(t) + '\u0001' + t.album;
const byAlbumOrder = (a, b) => (a.discNo || 0) - (b.discNo || 0) || (a.trackNo || 0) - (b.trackNo || 0) || collator.compare(a.title, b.title);
const isBlack = (t) => S.blacklist.has(t.path);

function applyData(d) {
  S.folders = d.folders || [];
  S.tracks = d.tracks || [];
  S.blacklist = new Map((d.blacklist || []).map((b) => [b.path, b]));
  S.settings = d.settings || {};
  rebuild();
}
function rebuild() {
  S.byId = new Map(S.tracks.map((t) => [t.id, t]));
  const on = new Set(S.folders.filter((f) => f.enabled).map((f) => f.path));
  S.lib = S.tracks.filter((t) => on.has(t.folder)).sort((a, b) => collator.compare(a.title, b.title));
}
const persist = {
  settings: () => api.patch({ settings: S.settings }),
  blacklist: () => api.patch({ blacklist: [...S.blacklist.values()] }),
};
const saveSettingsSoon = debounce(persist.settings, 500);

// ═════════════════════════ 导航 ═════════════════════════
const VIEWS = [['artists', '艺术家'], ['albums', '专辑'], ['folders', '文件夹']];
const SETTINGS_TABS = [['library', '音乐库'], ['appearance', '外观'], ['playback', '播放'], ['blacklist', '黑名单'], ['about', '关于']];

const NAV_ICONS = { artists: 'artist', albums: 'album', folders: 'folder' };
function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([k, l]) =>
    `<button class="rail-btn${S.view === k ? ' active' : ''}" data-view="${k}">${icon(NAV_ICONS[k])}<span>${l}</span></button>`).join('');
  $('#btn-settings').classList.toggle('active', S.view === 'settings');
  $('#subnav').innerHTML = S.view === 'settings'
    ? SETTINGS_TABS.map(([k, l]) => `<button class="tab${S.settingsTab === k ? ' active' : ''}" data-stab="${k}">${l}</button>`).join('')
    : S.view === 'search' ? '<span class="crumb">搜索结果</span>' : '';
}
function go(v) {
  if (v === 'settings' && S.view !== 'settings' && S.view !== 'search') S.prevView = S.view;
  if (v !== 'search' && S.view === 'search') { $('#search').value = ''; S.search = ''; }
  S.view = v;
  render();
}
function render() {
  renderNav();
  S.redraw = null;
  const views = {
    artists: viewArtists, albums: viewAlbums,
    folders: viewFolders, search: viewSearch, settings: viewSettings,
  };
  views[S.view]();
}

// ═════════════════════════ 列表组件（虚拟滚动） ═════════════════════════
const ROW = 60;
function rowHtml(it, i, grouped) {
  if (it.h !== undefined) return `<div class="row head"><div class="h">${esc(it.h)}</div><div class="hs">${esc(it.sub)}</div></div>`;
  const cur = P.current && P.current.id === it.id;
  const idx = cur ? `<span class="eq${audio.paused ? ' paused' : ''}"><i></i><i></i><i></i></span>` : grouped ? it.trackNo || '—' : i + 1;
  return `<div class="row track${cur ? ' playing' : ''}${isBlack(it) ? ' black' : ''}" data-i="${i}">
    <div class="c-idx">${idx}</div>
    <div class="c-main"><div class="t">${esc(it.title)}</div><div class="s">${esc(artistOf(it))}</div></div>
    <div class="c-album">${esc(it.album)}</div>
    <div class="c-dur">${fmtTime(it.duration)}</div></div>`;
}
function mountList(host, items, ordered, header = '') {
  const grouped = items.length !== ordered.length;
  host.scrollTop = 0;
  host.innerHTML = `<div class="vhead">${header}</div><div class="vspacer" style="height:${items.length * ROW}px"><div class="vlayer"></div></div>`;
  const layer = host.querySelector('.vlayer');
  const head = host.querySelector('.vhead');
  const indexOf = new Map(ordered.map((t, i) => [t, i]));
  let selected = -1;
  const draw = () => {
    const start = Math.max(0, Math.floor(Math.max(0, host.scrollTop - head.offsetHeight) / ROW) - 6);
    const end = Math.min(items.length, start + Math.ceil((host.clientHeight || 800) / ROW) + 12);
    layer.style.transform = `translateY(${start * ROW}px)`;
    let html = '';
    for (let i = start; i < end; i++) html += rowHtml(items[i], indexOf.get(items[i]), grouped);
    layer.innerHTML = html;
    if (selected >= 0) layer.querySelector(`.row.track[data-i="${selected}"]`)?.classList.add('sel');
  };
  host.onscroll = () => requestAnimationFrame(draw);
  host.onclick = (e) => {
    const r = e.target.closest('.row.track');
    if (!r) return;
    selected = +r.dataset.i;
    layer.querySelector('.sel')?.classList.remove('sel');
    r.classList.add('sel');
  };
  host.ondblclick = (e) => {
    const r = e.target.closest('.row.track');
    if (r) playList(ordered, +r.dataset.i);
  };
  host.oncontextmenu = (e) => {
    const r = e.target.closest('.row.track');
    if (!r) return;
    e.preventDefault();
    trackMenu(e.clientX, e.clientY, ordered[+r.dataset.i]);
  };
  S.redraw = draw;
  draw();
}
function headHtml(title, tracks, extra = '') {
  return `<div class="rh-title"><span class="count">${tracks.length}</span>歌曲${title ? `<span class="chip">${esc(title)}</span>` : ''}</div>
    <div class="rh-actions">${extra}
      <button class="btn ghost" data-act="shuffleall">${icon('shuffle')}随机播放</button>
      <button class="btn" data-act="playall">${icon('play')}播放全部</button></div>`;
}
/** 在 #rhead / #list / #rfoot 中显示歌曲列表 */
function showTracks(tracks, { grouped = false, title = '', extraHead = '', header = '' } = {}) {
  const items = [];
  if (grouped) {
    const g = [...groupBy(tracks, albumKey).values()].sort((a, b) => (a[0].year || 0) - (b[0].year || 0) || collator.compare(a[0].album, b[0].album));
    for (const list of g) {
      const t0 = list[0];
      items.push({ h: t0.album, sub: albumArtistOf(t0) + (t0.year ? ' · ' + t0.year : '') });
      list.sort(byAlbumOrder).forEach((t) => items.push(t));
    }
  } else items.push(...tracks);
  const ordered = items.filter((x) => x.h === undefined);
  S.ctx = { tracks: ordered };
  if ($('#rhead')) $('#rhead').innerHTML = headHtml(title, ordered, extraHead);
  if ($('#rfoot')) $('#rfoot').innerHTML = `<span>${fmtSize(sum(ordered, (t) => t.size))}</span><span>${fmtTotal(sum(ordered, (t) => t.duration))}</span>`;
  mountList($('#list'), items, ordered, header);
}
function split(leftHead) {
  $('#view').innerHTML = `<div class="split">
    <section class="pane-left glass"><div class="pane-head">${leftHead}</div><div class="pane-list" id="left"></div></section>
    <section class="pane-right"><div class="pane-head" id="rhead"></div><div class="vlist" id="list"></div><div class="pane-foot" id="rfoot"></div></section></div>`;
}
function single() {
  $('#view').innerHTML = `<div class="single"><div class="pane-head" id="rhead"></div><div class="vlist" id="list"></div><div class="pane-foot" id="rfoot"></div></div>`;
}
function emptyView() {
  $('#view').innerHTML = `<div class="empty">${icon('music', 'big')}<h2>音乐库是空的</h2><p>添加包含音乐的文件夹，开始播放吧。</p>
    <button class="btn" id="empty-add">${icon('plus')}添加文件夹</button></div>`;
  $('#empty-add').onclick = addFolders;
}

// ═════════════════════════ 视图 ═════════════════════════
function albumsOf(tracks) {
  return [...groupBy(tracks, albumKey).values()]
    .map((list) => { list.sort(byAlbumOrder); const t = list[0]; return { key: albumKey(t), title: t.album, artist: albumArtistOf(t), year: t.year, tracks: list, cover: t.path }; })
    .sort((a, b) => (b.year || 0) - (a.year || 0) || collator.compare(a.title, b.title));
}
function viewArtists() {
  if (!S.lib.length) return emptyView();
  const g = groupBy(S.lib, (t) => t.artists);
  const keys = [...g.keys()].sort(collator.compare);
  if (!g.has(S.sel.artist)) S.sel.artist = keys[0];
  $('#view').innerHTML = `<div class="split">
    <section class="pane-left glass"><div class="pane-head">艺术家<span class="muted">${keys.length}</span></div><div class="pane-list" id="left"></div></section>
    <section class="pane-right"><div class="vlist" id="list"></div><div class="pane-foot" id="rfoot"></div></section></div>`;
  const left = $('#left');
  left.innerHTML = keys.map((k) => `<div class="li${k === S.sel.artist ? ' active' : ''}" data-k="${esc(k)}"><span>${esc(k)}</span><em>${g.get(k).length}</em></div>`).join('');
  left.onclick = (e) => {
    const li = e.target.closest('.li');
    if (!li) return;
    S.sel.artist = li.dataset.k;
    left.querySelector('.active')?.classList.remove('active');
    li.classList.add('active');
    showArtist(li.dataset.k, g.get(li.dataset.k));
  };
  centerIn(left, left.querySelector('.active'));
  showArtist(S.sel.artist, g.get(S.sel.artist));
}
function showArtist(name, tracks) {
  const albums = albumsOf(tracks);
  const header = `
    <div class="hero"><div class="meta">
      <div class="kicker">艺术家</div><h1>${esc(name)}</h1>
      <div class="sub">${albums.length} 张专辑 · ${tracks.length} 首 · ${fmtTotal(sum(tracks, (t) => t.duration))}</div>
      <div class="rh-actions"><button class="btn" data-act="playall">${icon('play')}播放全部</button>
        <button class="btn ghost" data-act="shuffleall">${icon('shuffle')}随机播放</button></div></div></div>
    <div class="shelf-title"><span>专辑</span></div>
    <div class="shelf">${albums.map((a, i) => `
      <div class="card" data-album="${i}" title="${esc(a.title)}">
        <div class="cover">${icon('music')}<img data-cover="${esc(a.cover)}" alt=""></div>
        <div class="t">${esc(a.title)}</div><div class="s">${a.year || ''}</div></div>`).join('')}</div>
    <div class="list-title">歌曲</div>`;
  showTracks(tracks, { grouped: true, header });
  const head = $('#list .vhead');
  observeCovers(head);
  head.onclick = (e) => {
    const c = e.target.closest('[data-album]');
    if (!c) return;
    S.sel.album = albums[+c.dataset.album].key;
    go('albums');
  };
}

function albumList() {
  return [...groupBy(S.lib, albumKey).values()]
    .map((list) => {
      list.sort(byAlbumOrder);
      const t = list[0];
      return { key: albumKey(t), title: t.album, artist: albumArtistOf(t), year: t.year, tracks: list, cover: t.path };
    })
    .sort((a, b) => collator.compare(a.title, b.title));
}
function viewAlbums() {
  if (!S.lib.length) return emptyView();
  const list = albumList();
  const sel = S.sel.album && list.find((a) => a.key === S.sel.album);
  if (sel) return viewAlbumDetail(sel);
  S.sel.album = null;
  $('#view').innerHTML = `<div class="grid-wrap"><div class="grid">${list.map((a, i) => `
    <div class="card" data-i="${i}">
      <div class="cover">${icon('music')}<img data-cover="${esc(a.cover)}" alt="">
        <button class="card-play" data-play="${i}" title="播放">${icon('play')}</button></div>
      <div class="t">${esc(a.title)}</div><div class="s">${esc(a.artist)}</div>
    </div>`).join('')}</div></div>`;
  observeCovers($('#view'));
  $('.grid').onclick = (e) => {
    const p = e.target.closest('[data-play]');
    if (p) { e.stopPropagation(); playList(list[+p.dataset.play].tracks, 0); return; }
    const c = e.target.closest('.card');
    if (c) { S.sel.album = list[+c.dataset.i].key; render(); }
  };
}
function viewAlbumDetail(a) {
  $('#view').innerHTML = `<div class="album-page"><div class="vlist" id="list"></div></div>`;
  const header = `
    <div class="hero" style="position: relative; padding-top: 52px">
      <button class="icon-btn back-btn" id="album-back" title="返回专辑">${icon('back')}</button>
      <div class="cover lg">${icon('music')}<img data-cover="${esc(a.cover)}" data-size="500" alt=""></div>
      <div class="meta"><div class="kicker">专辑</div><h1>${esc(a.title)}</h1>
        <div class="sub">${esc(a.artist)}${a.year ? ' · ' + a.year : ''} · ${a.tracks.length} 首 · ${fmtTotal(sum(a.tracks, (t) => t.duration))}</div>
        <div class="rh-actions"><button class="btn" data-act="playall">${icon('play')}播放</button>
          <button class="btn ghost" data-act="shuffleall">${icon('shuffle')}随机播放</button></div></div>
    </div>`;
  showTracks(a.tracks, { header });
  observeCovers($('#view'));
  $('#album-back').onclick = () => { S.sel.album = null; render(); };
}

function viewSearch() {
  const q = S.search.toLowerCase();
  const hits = S.lib.filter((t) => t.title.toLowerCase().includes(q) || artistOf(t).toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
  single();
  showTracks(hits, { title: `搜索：${S.search}` });
  if (!hits.length) $('#list').innerHTML = `<div class="hint">没有找到与「${esc(S.search)}」相关的歌曲</div>`;
}

function viewFolders() {
  const roots = S.folders.filter((f) => f.enabled);
  if (!roots.length || !S.lib.length) return emptyView();
  if (!roots.find((r) => r.path === S.sel.root)) { S.sel.root = roots[0].path; S.sel.dir = roots[0].path; }
  const root = S.sel.root;
  let dir = S.sel.dir && S.sel.dir.startsWith(root) ? S.sel.dir : root;
  S.sel.dir = dir;
  const sep = sepOf(root);
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  const sub = new Map();
  const here = [];
  for (const t of S.lib) {
    if (!t.path.startsWith(prefix)) continue;
    const rest = t.path.slice(prefix.length);
    const k = rest.indexOf(sep);
    if (k < 0) here.push(t);
    else { const n = rest.slice(0, k); sub.set(n, (sub.get(n) || 0) + 1); }
  }
  split(`<span>文件夹</span><select id="root">${roots.map((r) => `<option value="${esc(r.path)}"${r.path === root ? ' selected' : ''}>${esc(baseName(r.path))}</option>`).join('')}</select>`);
  const left = $('#left');
  left.innerHTML =
    (dir !== root ? `<div class="li" data-up>${icon('back')}<span>上一级</span></div>` : '') +
    [...sub].sort((a, b) => collator.compare(a[0], b[0])).map(([n, c]) => `<div class="li" data-d="${esc(n)}">${icon('folder')}<span>${esc(n)}</span><em>${c}</em></div>`).join('') +
    (!sub.size && dir === root ? '<div class="hint">没有子文件夹</div>' : '');
  left.onclick = (e) => {
    const li = e.target.closest('.li');
    if (!li) return;
    if ('up' in li.dataset) {
      const parent = dir.slice(0, dir.lastIndexOf(sep));
      S.sel.dir = parent.length < root.length ? root : parent;
    } else S.sel.dir = prefix + li.dataset.d;
    viewFolders();
  };
  $('#root').onchange = (e) => { S.sel.root = S.sel.dir = e.target.value; viewFolders(); };
  here.sort((a, b) => collator.compare(baseName(a.path), baseName(b.path)));
  showTracks(here, { title: dir === root ? baseName(root) : dir.slice(root.length).replace(/^[\\/]/, '') });
  if (!here.length) $('#list').innerHTML = '<div class="hint">此文件夹下没有直接包含的歌曲，请从左侧进入子文件夹。</div>';
}

// ═════════════════════════ 设置 ═════════════════════════
const ACCENTS = ['#ff5a3c', '#e53935', '#ff7043', '#f9a825', '#43a047', '#00acc1', '#1e88e5', '#7e57c2'];
function viewSettings() {
  const tab = S.settingsTab;
  let html = '';
  if (tab === 'library') {
    const counts = groupBy(S.tracks, (t) => t.folder);
    html = `<h2>音乐库</h2><p class="muted">添加文件夹到音乐库。取消勾选可在音乐库中暂时隐藏该文件夹。</p>
      <button class="link" id="add-folder">${icon('plus')}添加文件夹</button>
      <div class="folders">${S.folders.length ? S.folders.map((f, i) => `
        <div class="folder-row"><label><input type="checkbox" data-i="${i}"${f.enabled ? ' checked' : ''}>${icon('folder')}
          <span class="p">${esc(f.path)}</span><span class="n">${(counts.get(f.path) || []).length} 首</span></label>
          <button class="icon-btn sm" data-rm="${i}" title="从音乐库移除">${icon('close')}</button></div>`).join('')
        : '<div class="hint">尚未添加任何文件夹</div>'}</div>
      <div class="row-actions"><button class="btn" id="rescan">${icon('refresh')}立即刷新音乐库</button></div>
      <label class="opt"><input type="checkbox" id="opt-autoscan"${S.settings.autoScan !== false ? ' checked' : ''}>启动时自动刷新音乐库</label>
      <div class="stats">共 ${S.tracks.length} 首歌曲 · ${fmtSize(sum(S.tracks, (t) => t.size))} · ${fmtTotal(sum(S.tracks, (t) => t.duration))}</div>`;
  } else if (tab === 'appearance') {
    html = `<h2>外观</h2><p class="muted">背景会跟随正在播放的封面变色；主题色用于正在播放的歌曲、计数和没有封面时的背景。</p>
      <h3>主题色</h3><div class="swatches">${ACCENTS.map((c) => `<button class="sw${c === S.settings.accent ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>`;
  } else if (tab === 'playback') {
    html = `<h2>播放</h2>
      <h3>歌曲切换</h3>
      <div class="opt-range"><span>淡入淡出</span>
        <input type="range" id="opt-xfade" min="0" max="12" step="1" value="${crossfadeSec()}" style="--p:${(crossfadeSec() / 12) * 100}%">
        <b id="xfade-val">${xfadeLabel(crossfadeSec())}</b></div>
      <p class="muted small">设为 0 时为无缝衔接：下一首会提前加载，并在当前歌曲结束的瞬间接上，适合现场专辑、古典、DJ 混音等连续曲目。<br>大于 0 时，两首歌会在结尾交叉渐变。手动切歌总是立即切换。</p>
      <h3>其他</h3>
      <label class="opt"><input type="checkbox" id="opt-tray"${S.settings.closeToTray !== false ? ' checked' : ''}>关闭窗口时最小化到系统托盘（右键托盘图标可退出）</label>
      <label class="opt"><input type="checkbox" id="opt-restore"${S.settings.restoreSession !== false ? ' checked' : ''}>启动时恢复上次的播放队列和进度</label>
      <h3>快捷键</h3><table class="kbd">
        <tr><td><kbd>Space</kbd></td><td>播放 / 暂停</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>←</kbd></td><td>下一首 / 上一首</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></td><td>音量 + / −</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>F</kbd></td><td>搜索</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>关闭弹层</td></tr></table>`;
  } else if (tab === 'about') {
    const u = UPD.info;
    html = `<h2>关于 Pulse</h2>
      <div class="about-ver muted">当前版本 <b style="color: var(--text)">${esc(UPD.current || '—')}</b></div>
      <div class="row-actions">
        <button class="btn" id="upd-check"${api.updateCheck ? '' : ' disabled'}>${icon('refresh')}检查更新</button>
        ${u && u.available && !UPD.busy ? `<button class="btn ghost" id="upd-go">${icon('down')}更新到 ${esc(u.latest)} 并重启</button>` : ''}
        <span class="muted" id="upd-status">${esc(UPD.status)}</span></div>
      <label class="opt"><input type="checkbox" id="opt-autoupd"${S.settings.autoUpdateCheck !== false ? ' checked' : ''}>启动时自动检查更新</label>
      <p class="muted small">更新会从 GitHub Releases（LiuTao341/Pulse）下载新的 exe，替换当前程序文件并自动重启，播放进度会保留。<br>
        程序所在的文件夹需要可写；如果放在只读位置，请手动下载。</p>`;
  } else {
    const list = [...S.blacklist.values()];
    html = `<h2>黑名单</h2><p>黑名单中的歌曲在播放时将被跳过。</p>
      <button class="btn ghost" id="bl-clear"${list.length ? '' : ' disabled'}>清空黑名单…</button>
      <div class="bl">${list.map((b) => `<div class="bl-row"><div><div class="t">${esc(b.title)}</div><div class="s">${esc(b.artist)}</div></div>
        <button class="link" data-unblack="${esc(b.path)}">移除</button></div>`).join('') || '<div class="hint">黑名单为空</div>'}</div>`;
  }
  $('#view').innerHTML = `<div class="settings"><div class="glass">${html}</div></div>`;
  const v = $('#view');

  if (tab === 'library') {
    $('#add-folder').onclick = addFolders;
    $('#rescan').onclick = () => doScan();
    $('#opt-autoscan').onchange = (e) => { S.settings.autoScan = e.target.checked; persist.settings(); };
    v.querySelectorAll('.folder-row input').forEach((cb) => (cb.onchange = async () => {
      S.folders = await api.toggleFolder(S.folders[+cb.dataset.i].path, cb.checked);
      rebuild();
    }));
    v.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      const f = S.folders[+b.dataset.rm];
      if (!(await askConfirm(`从音乐库移除「${f.path}」？磁盘上的文件不会被删除。`))) return;
      const r = await api.removeFolder(f.path);
      S.folders = r.folders; S.tracks = r.tracks; rebuild(); render();
    }));
  } else if (tab === 'appearance') {
    v.querySelectorAll('.sw').forEach((b) => (b.onclick = () => { setAccent(b.dataset.c); persist.settings(); viewSettings(); }));
  } else if (tab === 'playback') {
    $('#opt-restore').onchange = (e) => { S.settings.restoreSession = e.target.checked; persist.settings(); };
    $('#opt-tray').onchange = (e) => { S.settings.closeToTray = e.target.checked; persist.settings(); };
    $('#opt-xfade').oninput = (e) => {
      const v = +e.target.value;
      S.settings.crossfade = v;
      e.target.style.setProperty('--p', (v / 12) * 100 + '%');
      $('#xfade-val').textContent = xfadeLabel(v);
      saveSettingsSoon();
    };
  } else if (tab === 'about') {
    if ($('#upd-check')) $('#upd-check').onclick = () => checkUpdate(true);
    if ($('#upd-go')) $('#upd-go').onclick = installUpdate;
    $('#opt-autoupd').onchange = (e) => { S.settings.autoUpdateCheck = e.target.checked; persist.settings(); };
  } else {
    $('#bl-clear').onclick = async () => {
      if (!(await askConfirm('清空黑名单？'))) return;
      S.blacklist.clear(); persist.blacklist(); viewSettings();
    };
    v.querySelectorAll('[data-unblack]').forEach((b) => (b.onclick = () => {
      S.blacklist.delete(b.dataset.unblack); persist.blacklist(); viewSettings();
    }));
  }
}
const xfadeLabel = (v) => (v ? `${v} 秒` : '关闭（无缝衔接）');
const lighten = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0');
  return '#' + ch(n >> 16) + ch((n >> 8) & 255) + ch(n & 255);
};
function setAccent(c) {
  S.settings.accent = c;
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-text', lighten(c, 0.35));
}

// ═════════════════════════ 音乐库操作 ═════════════════════════
async function addFolders() {
  const f = await api.addFolders();
  if (!f) return;
  S.folders = f;
  rebuild();
  render();
  doScan();
}
async function doScan() {
  if (S.scanning) return;
  S.scanning = true;
  const ind = $('#scan-ind');
  ind.textContent = '正在扫描…';
  ind.classList.add('on');
  try {
    const tracks = await api.scan();
    if (tracks) {
      S.tracks = tracks;
      rebuild();
      if (P.current) P.current = S.byId.get(P.current.id) || P.current;
      render();
      toast(`音乐库已更新：${S.lib.length} 首歌曲`);
    }
  } catch (e) {
    toast('扫描失败：' + e.message);
  } finally {
    S.scanning = false;
    ind.classList.remove('on');
  }
}

// ═════════════════════════ 黑名单 ═════════════════════════
function setBlack(t, on) {
  if (on) S.blacklist.set(t.path, { path: t.path, title: t.title, artist: artistOf(t) });
  else S.blacklist.delete(t.path);
  persist.blacklist();
  S.redraw?.();
  renderQueue();
  toast(on ? '已加入黑名单，播放时将自动跳过' : '已移出黑名单');
  if (on && P.current && P.current.path === t.path && !audio.paused) next();
}

// ═════════════════════════ 右键菜单 / 弹窗 / 提示 ═════════════════════════
function trackMenu(x, y, t) {
  const ctx = S.ctx;
  const items = [
    { label: '播放', action: () => playList(ctx.tracks, ctx.tracks.indexOf(t)) },
    { label: '下一首播放', action: () => playNext(t) },
    { label: '添加到播放队列', action: () => enqueue(t) },
    '-',
    isBlack(t) ? { label: '移出黑名单', action: () => setBlack(t, false) } : { label: '加入黑名单', danger: true, action: () => setBlack(t, true) },
    { label: '在文件夹中显示', action: () => api.showInFolder(t.path) },
  ];
  showMenu(x, y, items);
}
function showMenu(x, y, items) {
  const m = $('#menu');
  m.innerHTML = items.map((it, i) => (it === '-' ? '<div class="sep"></div>' : `<div class="mi${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</div>`)).join('');
  m.style.left = '0px';
  m.style.top = '0px';
  m.classList.add('open');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.onclick = (e) => {
    const el = e.target.closest('.mi');
    if (!el) return;
    hideMenu();
    items[+el.dataset.i].action();
  };
}
const hideMenu = () => $('#menu').classList.remove('open');

function openDialog(inner, onKey) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.innerHTML = `<div class="dialog">${inner}</div>`;
    m.classList.add('open');
    const done = (v) => { m.classList.remove('open'); m.innerHTML = ''; document.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } else if (e.key === 'Enter') { e.stopPropagation(); done(onKey()); } };
    document.addEventListener('keydown', key, true);
    m.onmousedown = (e) => { if (e.target === m) done(null); };
    m.onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1' ? onKey() : null); };
  });
}
async function askConfirm(text) {
  const r = await openDialog(`<h3>${esc(text)}</h3><div class="dlg-btns"><button class="btn ghost" data-r="0">取消</button><button class="btn" data-r="1">确认</button></div>`, () => true);
  return !!r;
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

// ═════════════════════════ 封面 ═════════════════════════
const coverMem = new Map();
function loadCover(p, size = 300) {
  const k = p + '|' + size;
  if (!coverMem.has(k)) {
    if (coverMem.size > 800) coverMem.delete(coverMem.keys().next().value);
    coverMem.set(k, api.getCover(p, size).catch(() => null));
  }
  return coverMem.get(k);
}
const coverObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const img = e.target;
    coverObs.unobserve(img);
    loadCover(img.dataset.cover, +img.dataset.size || 300).then((u) => { if (u) { img.src = u; img.classList.add('ok'); } });
  }
}, { rootMargin: '300px' });
const observeCovers = (root) => root.querySelectorAll('img[data-cover]').forEach((i) => coverObs.observe(i));

// ═════════════════════════ 播放引擎 ═════════════════════════
// 两个 <audio> 交替使用：当前曲目播放时，另一个预加载下一首。
// 快结束时提前启动下一首：淡入淡出为 0 时做无缝衔接，大于 0 时做等功率交叉渐变。
const decks = [new Audio(), new Audio()];
decks.forEach((d) => { d.preload = 'auto'; d._fade = 1; d._id = null; d._ramp = null; });
let audio = decks[0];                       // 当前（正在播放的）deck
const otherDeck = () => (audio === decks[0] ? decks[1] : decks[0]);
const Vol = { pos: 0.8, muted: false };
// 对数音量：滑块位置 p → 增益 p³（约 60 dB 动态范围，听感上均匀变化）
const gainOf = (p) => Math.pow(Math.min(1, Math.max(0, p)), 3);
const applyGain = (d) => { d.volume = Vol.muted ? 0 : Math.min(1, Math.max(0, gainOf(Vol.pos) * d._fade)); };
const crossfadeSec = () => Math.max(0, Math.min(12, +S.settings.crossfade || 0));
let transitioning = false;

function ramp(d, to, ms, done) {
  clearInterval(d._ramp);
  const from = d._fade, t0 = performance.now();
  const step = () => {
    const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
    // 等功率曲线：淡入 sin、淡出 cos，交叉时总响度不塌陷
    const e = to > from ? Math.sin((k * Math.PI) / 2) : 1 - Math.cos((k * Math.PI) / 2);
    d._fade = from + (to - from) * e;
    applyGain(d);
    if (k >= 1) { clearInterval(d._ramp); d._ramp = null; if (done) done(); }
  };
  d._ramp = setInterval(step, 25);
  step();
}
function stopDeck(d) {
  clearInterval(d._ramp);
  d._ramp = null;
  d.pause();
  d._fade = 1;
  applyGain(d);
}
/** 立即结束正在进行的过渡（暂停、跳转、手动切歌时调用） */
function finishTransition() {
  const o = otherDeck();
  if (transitioning || !o.paused) { stopDeck(o); o._id = null; }
  clearInterval(audio._ramp);
  audio._ramp = null;
  audio._fade = 1;
  applyGain(audio);
  transitioning = false;
}

const P = { base: [], queue: [], pos: -1, repeat: 'off', shuffle: false, current: null };
const playable = (id) => S.byId.has(id) && !isBlack(S.byId.get(id));
function findPlayable(from, dir) {
  for (let i = from; i >= 0 && i < P.queue.length; i += dir) if (playable(P.queue[i])) return i;
  return -1;
}
function upcomingIndex() {
  if (P.repeat === 'one') return -1;
  let i = findPlayable(P.pos + 1, 1);
  if (i < 0 && P.repeat === 'all') i = findPlayable(0, 1);
  return i;
}
/** 让空闲的 deck 预加载下一首 */
function preloadNext() {
  const nx = otherDeck();
  if (transitioning || !nx.paused) return;
  const i = upcomingIndex();
  const id = i >= 0 ? P.queue[i] : null;
  if (!id || nx._id === id) return;
  nx._id = id;
  nx.src = S.byId.get(id).url;
  nx.load();
}
function setCurrent(i, t, counted) {
  P.pos = i;
  P.current = t;
  if (counted) { api.played(t.id); t.playCount = (t.playCount || 0) + 1; }
  updateNowPlaying(t);
  updatePlayState();
  renderQueue();
}
/** 自动过渡到第 i 首（由结尾监视器触发） */
function transitionTo(i, fadeMs) {
  const t = S.byId.get(P.queue[i]);
  if (!t) return;
  transitioning = true;
  const old = audio, nx = otherDeck();
  if (nx._id !== t.id) { nx._id = t.id; nx.src = t.url; } else if (nx.currentTime) nx.currentTime = 0;
  nx.loop = P.repeat === 'one';
  nx._fade = fadeMs > 0 ? 0 : 1;
  applyGain(nx);
  audio = nx;
  nx.play().catch(() => {});
  setCurrent(i, t, true);
  const fin = () => {
    if (old === audio) return;        // 期间用户手动切了歌
    stopDeck(old);
    old._id = null;
    transitioning = false;
    preloadNext();
  };
  if (fadeMs > 0) { ramp(nx, 1, fadeMs); ramp(old, 0, fadeMs, fin); }
  else setTimeout(fin, 400);           // 无缝：旧曲剩下的几十毫秒自然播完
}
// 结尾监视器：快结束时提前启动下一首
setInterval(() => {
  if (transitioning || audio.paused || audio.loop || !P.current) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 1) return;
  const left = d - audio.currentTime;
  const X = crossfadeSec();
  const lead = X > 0 ? Math.min(X, d / 3) : 0.05;
  if (left > lead) return;
  const i = upcomingIndex();
  if (i >= 0) transitionTo(i, X > 0 ? left * 1000 : 0);
}, 20);

function playList(tracks, start = 0, forceShuffle = false) {
  if (!tracks.length) return;
  const ids = tracks.map((t) => t.id);
  P.base = ids;
  if (forceShuffle) {
    P.shuffle = true;
    P.queue = shuffled(ids);
    P.pos = 0;
  } else if (P.shuffle) {
    const first = ids[start];
    P.queue = [first, ...shuffled(ids.filter((_, i) => i !== start))];
    P.pos = 0;
  } else {
    P.queue = ids.slice();
    P.pos = start;
  }
  S.settings.shuffle = P.shuffle;
  updateModeBtns();
  const i = findPlayable(P.pos, 1);
  if (i < 0) { toast('列表中的歌曲都在黑名单中'); return; }
  loadAt(i);
}
/** 手动切到第 i 首（立即切换，不做渐变） */
function loadAt(i, { autoplay = true, time = 0 } = {}) {
  const t = S.byId.get(P.queue[i]);
  if (!t) return;
  const cur = audio, o = otherDeck();
  clearInterval(cur._ramp); clearInterval(o._ramp);
  transitioning = false;
  let d;
  if (o._id === t.id && o.readyState >= 2) {   // 已经预加载好了，直接用
    cur.pause(); cur._id = null; d = o;
    if (o.currentTime) o.currentTime = 0;
  } else {
    o.pause(); d = cur; d._id = t.id; d.src = t.url;
  }
  cur._fade = o._fade = 1;
  applyGain(cur); applyGain(o);
  audio = d;
  d.loop = P.repeat === 'one';
  if (time) {
    if (d.readyState >= 1) d.currentTime = time;
    else d.addEventListener('loadedmetadata', () => { d.currentTime = time; }, { once: true });
  }
  if (autoplay) d.play().catch(() => {});
  setCurrent(i, t, autoplay);
  preloadNext();
}
function next(auto = false) {
  if (!P.queue.length) return;
  let i = findPlayable(P.pos + 1, 1);
  if (i < 0 && P.repeat === 'all') i = findPlayable(0, 1);
  if (i < 0) {
    if (auto) { audio.pause(); audio.currentTime = 0; }
    return;
  }
  loadAt(i);
}
function prev() {
  if (audio.currentTime > 3 || !P.queue.length) { finishTransition(); audio.currentTime = 0; return; }
  let i = findPlayable(P.pos - 1, -1);
  if (i < 0 && P.repeat === 'all') i = findPlayable(P.queue.length - 1, -1);
  if (i < 0) { audio.currentTime = 0; return; }
  loadAt(i);
}
function togglePlay() {
  if (!P.current) {
    const list = S.ctx.tracks.length ? S.ctx.tracks : S.lib;
    if (list.length) playList(list, 0);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else { finishTransition(); audio.pause(); }
}
function seekTo(sec) {
  finishTransition();
  audio.currentTime = sec;
}
function playNext(t) {
  if (!P.current) return playList([t], 0);
  P.queue.splice(P.pos + 1, 0, t.id);
  P.base.splice(P.base.indexOf(P.current.id) + 1, 0, t.id);
  renderQueue();
  preloadNext();
  toast('将在下一首播放');
}
function enqueue(t) {
  if (!P.current) return playList([t], 0);
  P.queue.push(t.id);
  P.base.push(t.id);
  renderQueue();
  preloadNext();
  toast('已添加到播放队列');
}
function removeFromQueue(i) {
  if (i === P.pos) return;
  const [id] = P.queue.splice(i, 1);
  const bi = P.base.indexOf(id);
  if (bi >= 0) P.base.splice(bi, 1);
  if (i < P.pos) P.pos--;
  renderQueue();
  preloadNext();
}
function toggleShuffle() {
  P.shuffle = !P.shuffle;
  S.settings.shuffle = P.shuffle;
  if (P.current) {
    const cur = P.current.id;
    if (P.shuffle) {
      const ci = P.base.indexOf(cur);
      P.queue = [cur, ...shuffled(P.base.filter((_, i) => i !== ci))];
      P.pos = 0;
    } else {
      P.queue = P.base.slice();
      P.pos = Math.max(0, P.queue.indexOf(cur));
    }
  }
  updateModeBtns();
  renderQueue();
  preloadNext();
  saveSettingsSoon();
}
function cycleRepeat() {
  P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat];
  S.settings.repeat = P.repeat;
  audio.loop = P.repeat === 'one';
  updateModeBtns();
  preloadNext();
  saveSettingsSoon();
}
function updateModeBtns() {
  const r = $('#btn-repeat');
  r.innerHTML = icon(P.repeat === 'one' ? 'repeat1' : 'repeat');
  r.classList.toggle('on', P.repeat !== 'off');
  r.title = { off: '循环：关', all: '循环：列表', one: '循环：单曲' }[P.repeat];
  $('#btn-shuffle').classList.toggle('on', P.shuffle);
}
function setVolume(p) {
  Vol.pos = Math.min(1, Math.max(0, p));
  Vol.muted = false;
  decks.forEach(applyGain);
  S.settings.volume = Vol.pos;
  $('#vol').value = Math.round(Vol.pos * 100);
  updateVolUi();
  saveSettingsSoon();
}
function toggleMute() {
  Vol.muted = !Vol.muted;
  decks.forEach(applyGain);
  updateVolUi();
}
function updateVolUi() {
  const vol = $('#vol');
  vol.style.setProperty('--p', (Vol.muted ? 0 : vol.value) + '%');
  vol.title = Vol.muted ? '已静音' : `${vol.value}%（${Vol.pos > 0 ? (60 * Math.log10(Vol.pos)).toFixed(0) : '-∞'} dB）`;
  $('#btn-mute').innerHTML = icon(Vol.muted || Vol.pos === 0 ? 'mute' : 'volume');
}
function updatePlayState() {
  $('#btn-play').innerHTML = icon(audio.paused ? 'play' : 'pause');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  S.redraw?.();
}

// —— 播放栏 / 正在播放 ——
function updateNowPlaying(t) {
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = artistOf(t);
  $('#npo-title').textContent = t.title;
  $('#npo-sub').textContent = `${artistOf(t)} · ${t.album}`;
  document.title = `${t.title} - ${artistOf(t)}`;
  api.setTrayTooltip && api.setTrayTooltip(`${t.title} - ${artistOf(t)}`.slice(0, 120));
  const small = $('#np-img'), big = $('#npo-img');
  small.classList.remove('ok');
  big.classList.remove('ok');
  loadCover(t.path, 200).then((u) => { if (P.current === t && u) { small.src = u; small.classList.add('ok'); } });
  loadCover(t.path, 600).then((u) => {
    if (P.current !== t) return;
    const bg = u ? `url("${u}")` : '';
    if (u) { big.src = u; big.classList.add('ok'); }
    $('#bd-img').style.backgroundImage = bg;
    $('#npo-bg').style.backgroundImage = bg;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: artistOf(t), album: t.album,
        artwork: u ? [{ src: u, sizes: '600x600', type: 'image/jpeg' }] : [],
      });
    }
  });
  loadLyrics(t);
}
let LRC = [], lrcIdx = -1;
function parseLrc(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const txt = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), txt });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function loadLyrics(t) {
  LRC = [];
  lrcIdx = -1;
  const box = $('#lyrics');
  box.innerHTML = '<div class="lrc-empty">暂无歌词（将同名 .lrc 文件放在歌曲旁即可显示）</div>';
  const txt = await api.getLyrics(t.path).catch(() => null);
  if (P.current !== t || !txt) return;
  LRC = parseLrc(txt);
  box.innerHTML = LRC.length
    ? LRC.map((l, i) => `<p data-i="${i}">${esc(l.txt) || '&nbsp;'}</p>`).join('')
    : txt.split(/\r?\n/).map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('');
}
function syncLyrics(time) {
  if (!LRC.length) return;
  let i = LRC.length - 1;
  while (i >= 0 && LRC[i].t > time + 0.2) i--;
  if (i === lrcIdx) return;
  lrcIdx = i;
  const box = $('#lyrics');
  box.querySelector('.on')?.classList.remove('on');
  const p = box.children[i];
  if (!p) return;
  p.classList.add('on');
  if ($('#npo').classList.contains('open')) centerIn(box, p, true);
}

function renderQueue() {
  const panel = $('#queue');
  $('#queue-count').textContent = P.queue.length ? `${P.queue.length} 首` : '';
  if (!panel.classList.contains('open')) return;
  const box = $('#queue-list');
  box.innerHTML = P.queue.map((id, i) => {
    const t = S.byId.get(id);
    if (!t) return '';
    return `<div class="qi${i === P.pos ? ' on' : ''}${isBlack(t) ? ' black' : ''}" data-i="${i}">
      <div class="c-main"><div class="t">${esc(t.title)}</div><div class="s">${esc(artistOf(t))}</div></div>
      <span class="d">${fmtTime(t.duration)}</span>
      <button class="icon-btn sm" data-rm="${i}" title="从队列移除">${icon('close')}</button></div>`;
  }).join('') || '<div class="hint">播放队列为空</div>';
  centerIn(box, box.querySelector('.qi.on'));
}

// —— 会话恢复 ——
function saveSession() {
  if (S.settings.restoreSession === false) return;
  S.settings.lastSession = P.current ? { base: P.base, queue: P.queue, pos: P.pos, time: audio.currentTime } : null;
  persist.settings();
}
function restoreSession() {
  const s = S.settings.lastSession;
  if (!s || S.settings.restoreSession === false) return;
  const cur = s.queue[s.pos];
  P.queue = s.queue.filter((id) => S.byId.has(id));
  P.base = (s.base || s.queue).filter((id) => S.byId.has(id));
  const i = P.queue.indexOf(cur);
  if (i >= 0) loadAt(i, { autoplay: false, time: s.time || 0 });
}

// ═════════════════════════ 事件绑定 ═════════════════════════
function bind() {
  document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));

  // 标题栏
  $('#nav').onclick = (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    if (b.dataset.view === 'albums' && S.view === 'albums') S.sel.album = null; // 再点一次回到专辑墙
    go(b.dataset.view);
  };
  $('#subnav').onclick = (e) => {
    const b = e.target.closest('[data-stab]');
    if (b) { S.settingsTab = b.dataset.stab; render(); }
  };
  $('#btn-settings').onclick = () => go('settings');
  $('#win-min').onclick = () => api.minimize();
  $('#win-max').onclick = () => api.toggleMax();
  $('#win-close').onclick = () => { saveSession(); api.close(); };
  api.on('win:state', ({ maximized }) => ($('#win-max').innerHTML = icon(maximized ? 'restore' : 'max')));
  api.on('scan:progress', ({ done, total }) => ($('#scan-ind').textContent = `正在扫描 ${done}/${total}`));
  $('#update-pill').onclick = installUpdate;
  api.on('update:progress', ({ done, total }) => {
    const pct = total ? Math.floor((done / total) * 100) : 0;
    $('#update-pill').textContent = pct >= 100 ? '正在重启…' : `正在下载 ${pct}%`;
    updStatus(pct >= 100 ? '下载完成，正在重启…' : `正在下载 ${pct}%`);
  });
  api.on('tray', async (action) => {
    if (action === 'toggle') togglePlay();
    else if (action === 'next') next();
    else if (action === 'prev') prev();
    else if (action === 'quit') { saveSession(); await new Promise((r) => setTimeout(r, 150)); api.exit && api.exit(); }
  });

  const onSearch = debounce(() => {
    const q = $('#search').value.trim();
    if (q) {
      if (S.view !== 'search' && S.view !== 'settings') S.prevView = S.view;
      S.search = q;
      S.view = 'search';
      render();
    } else if (S.view === 'search') go(S.prevView);
  }, 200);
  $('#search').oninput = onSearch;

  // 列表顶部按钮（播放全部 / 随机）
  $('#view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'playall') playList(S.ctx.tracks, 0);
    else playList(S.ctx.tracks, 0, true);
  });

  // 播放控制
  $('#btn-play').onclick = togglePlay;
  $('#btn-next').onclick = () => next();
  $('#btn-prev').onclick = prev;
  $('#btn-shuffle').onclick = toggleShuffle;
  $('#btn-repeat').onclick = cycleRepeat;
  $('#btn-mute').onclick = toggleMute;
  $('#vol').oninput = (e) => setVolume(e.target.value / 100);
  $('#btn-queue').onclick = () => { $('#btn-queue').classList.toggle('on', $('#queue').classList.toggle('open')); renderQueue(); };
  $('#queue-close').onclick = () => { $('#queue').classList.remove('open'); $('#btn-queue').classList.remove('on'); };
  $('#queue-list').onclick = (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { removeFromQueue(+rm.dataset.rm); return; }
    const qi = e.target.closest('.qi');
    if (qi) loadAt(+qi.dataset.i);
  };
  $('#np-open').onclick = () => P.current && $('#npo').classList.toggle('open');
  $('#npo-close').onclick = () => $('#npo').classList.remove('open');
  $('#lyrics').onclick = (e) => {
    const p = e.target.closest('p[data-i]');
    if (p && LRC[+p.dataset.i]) seekTo(LRC[+p.dataset.i].t);
  };

  // 进度条
  const seek = $('#seek');
  let seeking = false;
  const ratio = (e) => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const setFill = (r) => ($('#seek-fill').style.width = r * 100 + '%');
  seek.onpointerdown = (e) => { if (!audio.duration) return; seeking = true; seek.setPointerCapture(e.pointerId); setFill(ratio(e)); };
  seek.onpointermove = (e) => { if (seeking) setFill(ratio(e)); else seek.title = fmtTime(ratio(e) * (audio.duration || 0)); };
  seek.onpointerup = (e) => { if (!seeking) return; seeking = false; seekTo(ratio(e) * audio.duration); };

  // audio 事件（两个 deck 都监听，只处理当前 deck 的）
  const on = (type, fn) => decks.forEach((d) => d.addEventListener(type, (e) => { if (e.target === audio) fn(e); }));
  on('timeupdate', () => {
    const d = audio.duration || (P.current && P.current.duration) || 0;
    if (!seeking) setFill(d ? audio.currentTime / d : 0);
    $('#time').innerHTML = `<b>${fmtTime(audio.currentTime)}</b> / ${fmtTime(d)}`;
    syncLyrics(audio.currentTime);
  });
  on('loadedmetadata', () => {
    if (P.current && !P.current.duration) P.current.duration = audio.duration;
  });
  on('play', updatePlayState);
  on('pause', updatePlayState);
  on('ended', () => next(true));
  let errors = 0;
  on('playing', () => (errors = 0));
  on('error', () => {
    if (!P.current || !audio.getAttribute('src')) return;
    toast(`无法播放：${P.current.title}`);
    if (++errors < 5) {
      const i = findPlayable(P.pos + 1, 1);
      if (i >= 0) setTimeout(() => loadAt(i), 600);
    }
  });

  // 系统媒体键
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.paused && togglePlay());
    ms.setActionHandler('pause', () => !audio.paused && togglePlay());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next());
    ms.setActionHandler('seekto', (d) => seekTo(d.seekTime));
  }

  // 全局
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
  window.addEventListener('blur', hideMenu);
  window.addEventListener('resize', () => S.redraw?.());
  window.addEventListener('beforeunload', saveSession);
  setInterval(() => { if (!audio.paused) saveSession(); }, 30000);
  document.addEventListener('keydown', (e) => {
    if ($('#modal').classList.contains('open')) return;
    const el = e.target;
    const typing = (el.tagName === 'INPUT' && !['checkbox', 'range'].includes(el.type)) || el.tagName === 'SELECT';
    if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); return; }
    if (e.key === 'Escape') {
      hideMenu();
      if (typing) el.blur();
      $('#npo').classList.remove('open');
      $('#queue').classList.remove('open');
      $('#btn-queue').classList.remove('on');
      return;
    }
    if (typing) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.ctrlKey && e.key === 'ArrowRight') next();
    else if (e.ctrlKey && e.key === 'ArrowLeft') prev();
    else if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); setVolume(Vol.pos + 0.05); }
    else if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); setVolume(Vol.pos - 0.05); }
  });
}

// ═════════════════════════ 应用内更新 ═════════════════════════
const UPD = { current: '', info: null, status: '', busy: false };
function updStatus(text) {
  UPD.status = text;
  const el = $('#upd-status');
  if (el) el.textContent = text;
}
function showUpdatePill() {
  const pill = $('#update-pill');
  const u = UPD.info;
  pill.hidden = !(u && u.available);
  if (!pill.hidden && !UPD.busy) pill.innerHTML = `${icon('down')}新版本 ${esc(u.latest)} · 更新并重启`;
}
async function checkUpdate(manual = false) {
  if (!api.updateCheck || UPD.busy) return;
  updStatus('正在检查…');
  try {
    UPD.info = await api.updateCheck();
    UPD.current = UPD.info.current;
    updStatus(UPD.info.available ? `发现新版本 ${UPD.info.latest}` : '已是最新版本');
  } catch (e) {
    updStatus('检查失败：' + (e && e.message ? e.message : e));
    if (manual) toast('检查更新失败');
  }
  showUpdatePill();
  if (S.view === 'settings' && S.settingsTab === 'about') viewSettings();
}
async function installUpdate() {
  const u = UPD.info;
  if (!u || !u.available || UPD.busy) return;
  if (!(await askConfirm(`更新到 ${u.latest}？下载完成后 Pulse 会自动重启，播放进度会保留。`))) return;
  UPD.busy = true;
  const pill = $('#update-pill');
  pill.hidden = false;
  pill.disabled = true;
  pill.textContent = '正在下载 0%';
  updStatus('正在下载…');
  saveSession();
  try {
    await api.updateInstall(u.url); // 成功时程序会退出并自动重启
  } catch (e) {
    UPD.busy = false;
    pill.disabled = false;
    showUpdatePill();
    updStatus('更新失败：' + (e && e.message ? e.message : e));
    toast('更新失败：' + (e && e.message ? e.message : e));
  }
}

// ═════════════════════════ 启动 ═════════════════════════
async function init() {
  bind();
  applyData(await api.getLibrary());
  setAccent(S.settings.accent || '#e53935');
  P.repeat = S.settings.repeat || 'off';
  P.shuffle = !!S.settings.shuffle;
  Vol.pos = S.settings.volume ?? 0.8;
  decks.forEach(applyGain);
  $('#vol').value = Math.round(Vol.pos * 100);
  updateVolUi();
  updateModeBtns();
  render();
  restoreSession();
  if (S.settings.autoScan !== false && S.folders.length) doScan();
  if (api.version) api.version().then((v) => (UPD.current = v)).catch(() => {});
  if (api.updateCheck && S.settings.autoUpdateCheck !== false) setTimeout(() => checkUpdate(false), 4000);
}
init();
