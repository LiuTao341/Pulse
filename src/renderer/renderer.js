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
};
const icon = (n, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

// ═════════════════════════ 状态 ═════════════════════════
const S = {
  folders: [], tracks: [], lib: [], byId: new Map(), blacklist: new Map(), playlists: [], settings: {},
  view: 'artists', prevView: 'artists', settingsTab: 'library', sel: {}, search: '', songSort: 'title',
  ctx: { tracks: [], playlistId: null }, redraw: null, scanning: false,
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
  S.playlists = d.playlists || [];
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
  playlists: () => api.patch({ playlists: S.playlists }),
  blacklist: () => api.patch({ blacklist: [...S.blacklist.values()] }),
};
const saveSettingsSoon = debounce(persist.settings, 500);

// ═════════════════════════ 导航 ═════════════════════════
const VIEWS = [['artists', '艺术家'], ['genres', '风格'], ['albums', '专辑'], ['songs', '歌曲'], ['playlists', '播放列表'], ['folders', '文件夹']];
const SETTINGS_TABS = [['library', '音乐库'], ['appearance', '外观'], ['playback', '播放'], ['blacklist', '黑名单']];

function renderNav() {
  const inSettings = S.view === 'settings';
  $('#logo').classList.toggle('hidden', inSettings);
  $('#nav').innerHTML = inSettings
    ? `<button class="back" data-back title="返回">${icon('back')}</button>` +
      SETTINGS_TABS.map(([k, l]) => `<button data-stab="${k}" class="${S.settingsTab === k ? 'active' : ''}">${l}</button>`).join('')
    : VIEWS.map(([k, l]) => `<button data-view="${k}" class="${S.view === k ? 'active' : ''}">${l}</button>`).join('');
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
    artists: () => viewGroup('artists'), genres: () => viewGroup('genres'), albums: viewAlbums, songs: viewSongs,
    playlists: viewPlaylists, folders: viewFolders, search: viewSearch, settings: viewSettings,
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
function mountList(host, items, ordered) {
  const grouped = items.length !== ordered.length;
  host.innerHTML = `<div class="vspacer" style="height:${items.length * ROW}px"><div class="vlayer"></div></div>`;
  const layer = host.querySelector('.vlayer');
  const indexOf = new Map(ordered.map((t, i) => [t, i]));
  let selected = -1;
  const draw = () => {
    const start = Math.max(0, Math.floor(host.scrollTop / ROW) - 6);
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
function showTracks(tracks, { grouped = false, playlistId = null, title = '', extraHead = '' } = {}) {
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
  S.ctx = { tracks: ordered, playlistId };
  if ($('#rhead')) $('#rhead').innerHTML = headHtml(title, ordered, extraHead);
  if ($('#rfoot')) $('#rfoot').innerHTML = `<span>${fmtSize(sum(ordered, (t) => t.size))}</span><span>${fmtTotal(sum(ordered, (t) => t.duration))}</span>`;
  mountList($('#list'), items, ordered);
}
function split(leftHead) {
  $('#view').innerHTML = `<div class="split">
    <section class="pane-left"><div class="pane-head">${leftHead}</div><div class="pane-list" id="left"></div></section>
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
function viewGroup(kind) {
  if (!S.lib.length) return emptyView();
  const fn = kind === 'artists' ? (t) => t.artists : (t) => (t.genres.length ? t.genres : ['未知风格']);
  const g = groupBy(S.lib, fn);
  const keys = [...g.keys()].sort(collator.compare);
  if (!g.has(S.sel[kind])) S.sel[kind] = keys[0];
  split(kind === 'artists' ? `艺术家<span class="muted">${keys.length}</span>` : `风格<span class="muted">${keys.length}</span>`);
  const left = $('#left');
  left.innerHTML = keys.map((k) => `<div class="li${k === S.sel[kind] ? ' active' : ''}" data-k="${esc(k)}"><span>${esc(k)}</span><em>${g.get(k).length}</em></div>`).join('');
  left.onclick = (e) => {
    const li = e.target.closest('.li');
    if (!li) return;
    S.sel[kind] = li.dataset.k;
    left.querySelector('.active')?.classList.remove('active');
    li.classList.add('active');
    showTracks(g.get(li.dataset.k), { grouped: true, title: li.dataset.k });
  };
  left.querySelector('.active')?.scrollIntoView({ block: 'center' });
  showTracks(g.get(S.sel[kind]), { grouped: true, title: S.sel[kind] });
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
  $('#view').innerHTML = `<div class="album-page">
    <div class="album-hero">
      <button class="icon-btn" id="album-back" title="返回">${icon('back')}</button>
      <div class="cover lg">${icon('music')}<img data-cover="${esc(a.cover)}" data-size="400" alt=""></div>
      <div class="meta"><div class="kicker">专辑</div><h1>${esc(a.title)}</h1>
        <div class="sub">${esc(a.artist)}${a.year ? ' · ' + a.year : ''} · ${a.tracks.length} 首 · ${fmtTotal(sum(a.tracks, (t) => t.duration))}</div>
        <div class="rh-actions"><button class="btn" data-act="playall">${icon('play')}播放</button>
          <button class="btn ghost" data-act="shuffleall">${icon('shuffle')}随机播放</button></div></div>
    </div><div class="vlist" id="list"></div></div>`;
  observeCovers($('#view'));
  $('#album-back').onclick = () => { S.sel.album = null; render(); };
  showTracks(a.tracks);
}

const SORTS = {
  title: ['标题', (a, b) => collator.compare(a.title, b.title)],
  artist: ['艺术家', (a, b) => collator.compare(artistOf(a), artistOf(b)) || collator.compare(a.title, b.title)],
  album: ['专辑', (a, b) => collator.compare(a.album, b.album) || byAlbumOrder(a, b)],
  duration: ['时长', (a, b) => a.duration - b.duration],
  added: ['最近添加', (a, b) => b.addedAt - a.addedAt],
  plays: ['最常播放', (a, b) => (b.playCount || 0) - (a.playCount || 0)],
};
function viewSongs() {
  if (!S.lib.length) return emptyView();
  single();
  const sel = `<select id="sort" title="排序">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${k === S.songSort ? ' selected' : ''}>按${l}</option>`).join('')}</select>`;
  showTracks(S.lib.slice().sort(SORTS[S.songSort][1]), { extraHead: sel });
  $('#sort').onchange = (e) => { S.songSort = e.target.value; viewSongs(); };
}

function viewSearch() {
  const q = S.search.toLowerCase();
  const hits = S.lib.filter((t) => t.title.toLowerCase().includes(q) || artistOf(t).toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
  single();
  showTracks(hits, { title: `搜索：${S.search}` });
  if (!hits.length) $('#list').innerHTML = `<div class="hint">没有找到与「${esc(S.search)}」相关的歌曲</div>`;
}

function viewPlaylists() {
  split(`<span>播放列表</span><button class="link" id="pl-new">${icon('plus')}新建</button>`);
  $('#pl-new').onclick = async () => {
    const n = await askText('新建播放列表', '');
    if (n) { S.sel.pl = createPlaylist(n).id; viewPlaylists(); }
  };
  const left = $('#left');
  if (!S.playlists.length) {
    left.innerHTML = '<div class="hint">还没有播放列表</div>';
    $('#list').innerHTML = '<div class="hint">在任意歌曲上点击右键 → 添加到播放列表</div>';
    return;
  }
  if (!S.playlists.find((p) => p.id === S.sel.pl)) S.sel.pl = S.playlists[0].id;
  left.innerHTML = S.playlists.map((p) => `<div class="li${p.id === S.sel.pl ? ' active' : ''}" data-id="${p.id}"><span>${esc(p.name)}</span><em>${p.tracks.length}</em></div>`).join('');
  left.onclick = (e) => {
    const li = e.target.closest('.li');
    if (li) { S.sel.pl = li.dataset.id; viewPlaylists(); }
  };
  left.oncontextmenu = (e) => {
    const li = e.target.closest('.li');
    if (!li) return;
    e.preventDefault();
    const p = S.playlists.find((x) => x.id === li.dataset.id);
    const tracks = () => p.tracks.map((id) => S.byId.get(id)).filter(Boolean);
    showMenu(e.clientX, e.clientY, [
      { label: '播放', action: () => playList(tracks(), 0) },
      { label: '随机播放', action: () => playList(tracks(), 0, true) },
      '-',
      { label: '重命名…', action: async () => { const n = await askText('重命名播放列表', p.name); if (n) { p.name = n; persist.playlists(); viewPlaylists(); } } },
      { label: '删除播放列表', danger: true, action: async () => {
        if (await askConfirm(`删除播放列表「${p.name}」？歌曲文件不会被删除。`)) {
          S.playlists = S.playlists.filter((x) => x !== p); persist.playlists(); viewPlaylists();
        } } },
    ]);
  };
  const p = S.playlists.find((x) => x.id === S.sel.pl);
  showTracks(p.tracks.map((id) => S.byId.get(id)).filter(Boolean), { playlistId: p.id, title: p.name });
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
const ACCENTS = ['#e53935', '#ff7043', '#f9a825', '#43a047', '#00acc1', '#1e88e5', '#7e57c2', '#d81b60'];
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
    html = `<h2>外观</h2><p class="muted">主题色会应用到导航指示条、按钮、进度条和正在播放的歌曲。</p>
      <h3>主题色</h3><div class="swatches">${ACCENTS.map((c) => `<button class="sw${c === S.settings.accent ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>`;
  } else if (tab === 'playback') {
    html = `<h2>播放</h2>
      <label class="opt"><input type="checkbox" id="opt-restore"${S.settings.restoreSession !== false ? ' checked' : ''}>启动时恢复上次的播放队列和进度</label>
      <h3>快捷键</h3><table class="kbd">
        <tr><td><kbd>Space</kbd></td><td>播放 / 暂停</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>←</kbd></td><td>下一首 / 上一首</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></td><td>音量 + / −</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>F</kbd></td><td>搜索</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>关闭弹层</td></tr></table>`;
  } else {
    const list = [...S.blacklist.values()];
    html = `<h2 class="accent">黑名单</h2><p>黑名单中的歌曲在播放时将被跳过。</p>
      <button class="btn ghost" id="bl-clear"${list.length ? '' : ' disabled'}>清空黑名单…</button>
      <div class="bl">${list.map((b) => `<div class="bl-row"><div><div class="t">${esc(b.title)}</div><div class="s">${esc(b.artist)}</div></div>
        <button class="link" data-unblack="${esc(b.path)}">移除</button></div>`).join('') || '<div class="hint">黑名单为空</div>'}</div>`;
  }
  $('#view').innerHTML = `<div class="settings">${html}</div>`;
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
function setAccent(c) {
  S.settings.accent = c;
  document.documentElement.style.setProperty('--accent', c);
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

// ═════════════════════════ 播放列表 / 黑名单 ═════════════════════════
function createPlaylist(name) {
  const p = { id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, tracks: [] };
  S.playlists.push(p);
  persist.playlists();
  return p;
}
function addToPlaylist(id, ids) {
  const p = S.playlists.find((x) => x.id === id);
  if (!p) return;
  let n = 0;
  for (const x of ids) if (!p.tracks.includes(x)) { p.tracks.push(x); n++; }
  persist.playlists();
  toast(n ? `已添加到「${p.name}」` : '歌曲已在该播放列表中');
  if (S.view === 'playlists') viewPlaylists();
}
function removeFromPlaylist(id, tid) {
  const p = S.playlists.find((x) => x.id === id);
  if (!p) return;
  p.tracks = p.tracks.filter((x) => x !== tid);
  persist.playlists();
  viewPlaylists();
}
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
    ...S.playlists.map((p) => ({ label: `添加到「${p.name}」`, action: () => addToPlaylist(p.id, [t.id]) })),
    { label: '新建播放列表并添加…', action: async () => {
      const n = await askText('新建播放列表', '');
      if (n) addToPlaylist(createPlaylist(n).id, [t.id]);
    } },
    '-',
    ctx.playlistId ? { label: '从播放列表移除', action: () => removeFromPlaylist(ctx.playlistId, t.id) } : null,
    isBlack(t) ? { label: '移出黑名单', action: () => setBlack(t, false) } : { label: '加入黑名单', danger: true, action: () => setBlack(t, true) },
    { label: '在文件夹中显示', action: () => api.showInFolder(t.path) },
  ].filter(Boolean);
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
async function askText(title, value) {
  const p = openDialog(`<h3>${esc(title)}</h3><input id="dlg-in" value="${esc(value)}" spellcheck="false" placeholder="输入名称">
    <div class="dlg-btns"><button class="btn ghost" data-r="0">取消</button><button class="btn" data-r="1">确认</button></div>`,
  () => $('#dlg-in').value.trim() || null);
  $('#dlg-in').focus();
  $('#dlg-in').select();
  return p;
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

// ═════════════════════════ 播放器 ═════════════════════════
const audio = new Audio();
audio.preload = 'auto';
const P = { base: [], queue: [], pos: -1, repeat: 'off', shuffle: false, current: null };
const playable = (id) => S.byId.has(id) && !isBlack(S.byId.get(id));
function findPlayable(from, dir) {
  for (let i = from; i >= 0 && i < P.queue.length; i += dir) if (playable(P.queue[i])) return i;
  return -1;
}

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
function loadAt(i, { autoplay = true, time = 0 } = {}) {
  const t = S.byId.get(P.queue[i]);
  if (!t) return;
  P.pos = i;
  P.current = t;
  audio.src = t.url;
  if (time) audio.addEventListener('loadedmetadata', () => { audio.currentTime = time; }, { once: true });
  if (autoplay) {
    audio.play().catch(() => {});
    api.played(t.id);
    t.playCount = (t.playCount || 0) + 1;
  }
  updateNowPlaying(t);
  S.redraw?.();
  renderQueue();
}
function next(auto = false) {
  if (!P.queue.length) return;
  if (auto && P.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  let i = findPlayable(P.pos + 1, 1);
  if (i < 0 && P.repeat === 'all') i = findPlayable(0, 1);
  if (i < 0) {
    if (auto) { audio.pause(); audio.currentTime = 0; }
    return;
  }
  loadAt(i);
}
function prev() {
  if (audio.currentTime > 3 || !P.queue.length) { audio.currentTime = 0; return; }
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
  audio.paused ? audio.play() : audio.pause();
}
function playNext(t) {
  if (!P.current) return playList([t], 0);
  P.queue.splice(P.pos + 1, 0, t.id);
  P.base.splice(P.base.indexOf(P.current.id) + 1, 0, t.id);
  renderQueue();
  toast('将在下一首播放');
}
function enqueue(t) {
  if (!P.current) return playList([t], 0);
  P.queue.push(t.id);
  P.base.push(t.id);
  renderQueue();
  toast('已添加到播放队列');
}
function removeFromQueue(i) {
  if (i === P.pos) return;
  const [id] = P.queue.splice(i, 1);
  const bi = P.base.indexOf(id);
  if (bi >= 0) P.base.splice(bi, 1);
  if (i < P.pos) P.pos--;
  renderQueue();
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
  saveSettingsSoon();
}
function cycleRepeat() {
  P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat];
  S.settings.repeat = P.repeat;
  updateModeBtns();
  saveSettingsSoon();
}
function updateModeBtns() {
  const r = $('#btn-repeat');
  r.innerHTML = icon(P.repeat === 'one' ? 'repeat1' : 'repeat');
  r.classList.toggle('on', P.repeat !== 'off');
  r.title = { off: '循环：关', all: '循环：列表', one: '循环：单曲' }[P.repeat];
  $('#btn-shuffle').classList.toggle('on', P.shuffle);
}
function setVolume(v) {
  v = Math.min(1, Math.max(0, v));
  audio.volume = v;
  audio.muted = false;
  S.settings.volume = v;
  $('#vol').value = Math.round(v * 100);
  updateVolUi();
  saveSettingsSoon();
}
function updateVolUi() {
  const vol = $('#vol');
  vol.style.setProperty('--p', (audio.muted ? 0 : vol.value) + '%');
  $('#btn-mute').innerHTML = icon(audio.muted || audio.volume === 0 ? 'mute' : 'volume');
}

// —— 播放栏 / 正在播放 ——
function updateNowPlaying(t) {
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = artistOf(t);
  $('#npo-title').textContent = t.title;
  $('#npo-sub').textContent = `${artistOf(t)} · ${t.album}`;
  document.title = `${t.title} - ${artistOf(t)}`;
  const small = $('#np-img'), big = $('#npo-img');
  small.classList.remove('ok');
  big.classList.remove('ok');
  $('#npo-bg').style.backgroundImage = 'none';
  loadCover(t.path, 200).then((u) => { if (P.current === t && u) { small.src = u; small.classList.add('ok'); } });
  loadCover(t.path, 600).then((u) => {
    if (P.current !== t) return;
    if (u) { big.src = u; big.classList.add('ok'); $('#npo-bg').style.backgroundImage = `url("${u}")`; }
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
  if ($('#npo').classList.contains('open')) p.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
  box.querySelector('.qi.on')?.scrollIntoView({ block: 'center' });
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
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) go(b.dataset.view);
    else if (b.dataset.stab) { S.settingsTab = b.dataset.stab; render(); }
    else if ('back' in b.dataset) go(S.prevView || 'artists');
  };
  $('#btn-settings').onclick = () => go('settings');
  $('#win-min').onclick = () => api.minimize();
  $('#win-max').onclick = () => api.toggleMax();
  $('#win-close').onclick = () => { saveSession(); api.close(); };
  api.on('win:state', ({ maximized }) => ($('#win-max').innerHTML = icon(maximized ? 'restore' : 'max')));
  api.on('scan:progress', ({ done, total }) => ($('#scan-ind').textContent = `正在扫描 ${done}/${total}`));

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
  $('#btn-mute').onclick = () => { audio.muted = !audio.muted; updateVolUi(); };
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
    if (p && LRC[+p.dataset.i]) audio.currentTime = LRC[+p.dataset.i].t;
  };

  // 进度条
  const seek = $('#seek');
  let seeking = false;
  const ratio = (e) => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const setFill = (r) => ($('#seek-fill').style.width = r * 100 + '%');
  seek.onpointerdown = (e) => { if (!audio.duration) return; seeking = true; seek.setPointerCapture(e.pointerId); setFill(ratio(e)); };
  seek.onpointermove = (e) => { if (seeking) setFill(ratio(e)); else seek.title = fmtTime(ratio(e) * (audio.duration || 0)); };
  seek.onpointerup = (e) => { if (!seeking) return; seeking = false; audio.currentTime = ratio(e) * audio.duration; };

  // audio 事件
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || (P.current && P.current.duration) || 0;
    if (!seeking) setFill(d ? audio.currentTime / d : 0);
    $('#time').innerHTML = `<b>${fmtTime(audio.currentTime)}</b> / ${fmtTime(d)}`;
    syncLyrics(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => {
    if (P.current && !P.current.duration) P.current.duration = audio.duration;
  });
  const onPlayState = () => {
    $('#btn-play').innerHTML = icon(audio.paused ? 'play' : 'pause');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    S.redraw?.();
  };
  audio.addEventListener('play', onPlayState);
  audio.addEventListener('pause', onPlayState);
  audio.addEventListener('ended', () => next(true));
  let errors = 0;
  audio.addEventListener('playing', () => (errors = 0));
  audio.addEventListener('error', () => {
    if (!P.current || !audio.src) return;
    toast(`无法播放：${P.current.title}`);
    if (++errors < 5) {
      const i = findPlayable(P.pos + 1, 1);
      if (i >= 0) setTimeout(() => loadAt(i), 600);
    }
  });

  // 系统媒体键
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next());
    ms.setActionHandler('seekto', (d) => (audio.currentTime = d.seekTime));
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
    else if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); setVolume(audio.volume + 0.05); }
    else if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); setVolume(audio.volume - 0.05); }
  });
}

// ═════════════════════════ 启动 ═════════════════════════
async function init() {
  bind();
  applyData(await api.getLibrary());
  setAccent(S.settings.accent || '#e53935');
  P.repeat = S.settings.repeat || 'off';
  P.shuffle = !!S.settings.shuffle;
  audio.volume = S.settings.volume ?? 0.8;
  $('#vol').value = Math.round(audio.volume * 100);
  updateVolUi();
  updateModeBtns();
  render();
  restoreSession();
  if (S.settings.autoScan !== false && S.folders.length) doScan();
}
init();
