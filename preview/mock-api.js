'use strict';
// 浏览器预览用的模拟 API：不依赖 Electron，直接用浏览器打开 preview/index.html 即可看到界面。
(function () {
  const raw = [
    ['倒数', 'G.E.M.邓紫棋', '倒数', 2018, 229], ['光年之外', 'G.E.M.邓紫棋', '光年之外', 2016, 235],
    ['句号', 'G.E.M.邓紫棋', '启示录', 2022, 235], ['来自天堂的魔鬼', 'G.E.M.邓紫棋', '新的心跳', 2015, 245],
    ['等你下课(with 杨瑞代)', '周杰伦', '等你下课', 2018, 270], ['告白气球', '周杰伦', '周杰伦的床边故事', 2016, 215],
    ['明明就', '周杰伦', '十二新作', 2012, 260], ['飞云之下', '韩红;林俊杰', '飞云之下', 2017, 266],
    ['刚好遇见你', '李玉刚', '刚好遇见你', 2016, 200], ['倔强', '五月天', '神的孩子都在跳舞', 2004, 263],
    ['可不可以', '张紫豪', '可不可以', 2018, 240], ['空城', '杨坤', '空城', 2009, 277],
    ['芒种', '音阙诗听;赵方婧', '芒种', 2019, 216], ['平凡之路', '朴树', '猎户星座', 2017, 301],
    ['Believer', 'Imagine Dragons', 'Evolve', 2017, 204], ['Numb', 'Linkin Park', 'Meteora', 2003, 187],
    ['Waiting for Love', 'Avicii', 'Stories', 2015, 230], ['Unstoppable', 'Sia', 'This Is Acting', 2016, 217],
    ['Teeth', '5 Seconds Of Summer', 'Calm', 2020, 204], ['Sunset Drive', 'Tokyo Music Walker', 'Sunset Drive', 2019, 238],
  ];
  const genres = { 'G.E.M.邓紫棋': '华语流行', '周杰伦': '华语流行', '五月天': '摇滚', 'Linkin Park': '摇滚', 'Imagine Dragons': '摇滚', 'Avicii': '电子', 'Tokyo Music Walker': 'Lo-fi' };
  const folderOf = (i) => (i < 14 ? 'D:\\文件\\音乐\\华语前后鼻音' : i < 19 ? 'D:\\文件\\音乐\\LoliPop' : 'D:\\文件\\音乐\\InMyBGM');
  const tracks = raw.map(([title, artist, album, year, dur], i) => {
    const folder = folderOf(i);
    const sub = i < 4 ? '\\邓紫棋' : '';
    const p = `${folder}${sub}\\${artist.replace(/;/g, ',')} - ${title}.flac`;
    return {
      id: 't' + i, path: p, url: 'SILENT', folder, title, artists: artist.split(';'), album, albumArtist: '',
      genres: [genres[artist.split(';')[0]] || '流行'], year, trackNo: 1, discNo: 1, duration: dur,
      size: 28e6 + i * 1.3e6, mtime: 0, addedAt: Date.now() - i * 864e5, playCount: (i * 7) % 13,
    };
  });

  // 1 秒静音 wav，让 <audio> 在预览里也能正常加载
  function silentWav() {
    const n = 8000, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true);
    v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    let s = ''; new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
    return 'data:audio/wav;base64,' + btoa(s);
  }
  const silent = silentWav();
  tracks.forEach((t) => (t.url = silent));

  // 用渐变生成假封面
  const PALETTES = [['#ff512f', '#dd2476'], ['#1fa2ff', '#12d8fa'], ['#f7971e', '#ffd200'], ['#8e2de2', '#4a00e0'], ['#11998e', '#38ef7d'], ['#fc466b', '#3f5efb'], ['#ee0979', '#ff6a00'], ['#00c6ff', '#0072ff']];
  function fakeCover(seed, size) {
    let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [a, b] = PALETTES[h % PALETTES.length];
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, size, size); grad.addColorStop(0, a); grad.addColorStop(1, b);
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    g.globalAlpha = 0.18; g.fillStyle = '#fff';
    g.beginPath(); g.arc(size * 0.72, size * 0.3, size * (0.18 + (h % 7) / 40), 0, 7); g.fill();
    g.beginPath(); g.arc(size * 0.25, size * 0.8, size * 0.32, 0, 7); g.fill();
    return c.toDataURL('image/jpeg', 0.9);
  }

  const lrc = Array.from({ length: 24 }, (_, i) => `[00:${String(i * 2).padStart(2, '0')}.00]示例歌词 · 第 ${i + 1} 行`).join('\n');

  const data = {
    folders: [
      { path: 'D:\\文件\\音乐\\华语前后鼻音', enabled: true }, { path: 'D:\\文件\\音乐\\我木几粤语', enabled: true },
      { path: 'D:\\文件\\音乐\\LoliPop', enabled: true }, { path: 'D:\\文件\\音乐\\IHadBadEng', enabled: true },
      { path: 'D:\\文件\\音乐\\InMyBGM', enabled: true },
    ],
    tracks,
    blacklist: [
      { path: tracks[18].path, title: 'Teeth', artist: '5 Seconds Of Summer' },
      { path: tracks[16].path, title: 'Waiting for Love', artist: 'Avicii' },
    ],
    playlists: [
      { id: 'pl1', name: '学习专注', tracks: ['t19', 't13', 't9'] },
      { id: 'pl2', name: '跑步', tracks: ['t14', 't15', 't17'] },
    ],
    settings: { volume: 0.7, repeat: 'all', shuffle: false, accent: '#e53935', autoScan: false, restoreSession: true,
      lastSession: { base: tracks.map((t) => t.id), queue: tracks.map((t) => t.id), pos: 5, time: 0 } },
  };

  window.api = {
    minimize() {}, toggleMax() {}, close() {},
    getLibrary: async () => data,
    scan: async () => data.tracks,
    addFolders: async () => null,
    removeFolder: async () => ({ folders: data.folders, tracks: data.tracks }),
    toggleFolder: async (p, en) => { data.folders.find((f) => f.path === p).enabled = en; return data.folders; },
    patch: async () => true,
    getCover: async (p, size) => fakeCover(tracks.find((t) => t.path === p)?.album || p, Math.min(size || 300, 400)),
    getLyrics: async () => lrc,
    showInFolder() {}, played() {}, on() {},
  };
})();
