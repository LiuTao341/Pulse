'use strict';
// 极简 JSON 持久化：所有数据存在 userData/library.json
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  folders: [],      // [{ path, enabled }]
  tracks: [],       // 扫描得到的歌曲
  blacklist: [],    // [{ path, title, artist }]
  playlists: [],    // [{ id, name, tracks: [trackId] }]
  settings: {
    volume: 0.8,
    repeat: 'off',          // off | all | one
    shuffle: false,
    accent: '#e53935',
    autoScan: true,
    restoreSession: true,
    lastSession: null,
  },
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
    } catch { /* 首次启动 */ }
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('保存失败', e);
    }
  }
}

module.exports = Store;
