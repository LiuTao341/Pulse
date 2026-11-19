// Pulse —— Tauri 2 后端：音乐库扫描、标签/封面/歌词读取、持久化、系统托盘
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::tag::ItemKey;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const AUDIO_EXT: &[&str] = &["mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "webm"];
const COVER_NAMES: &[&str] = &["cover", "folder", "front", "album", "albumart"];

// ───────────────────────── 数据结构 ─────────────────────────
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Folder {
    path: String,
    enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Track {
    id: String,
    path: String,
    folder: String,
    title: String,
    artists: Vec<String>,
    album: String,
    album_artist: String,
    genres: Vec<String>,
    year: Option<u32>,
    track_no: Option<u32>,
    disc_no: Option<u32>,
    duration: f64,
    bitrate: u32,
    codec: String,
    size: u64,
    mtime: f64,
    added_at: f64,
    play_count: u32,
    last_played: f64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Data {
    folders: Vec<Folder>,
    tracks: Vec<Track>,
    blacklist: Value,
    playlists: Value,
    settings: Value,
}

struct AppState {
    data: Mutex<Data>,
    file: PathBuf,
    scanning: Mutex<bool>,
    covers: Mutex<HashMap<String, Option<String>>>,
}

// ───────────────────────── 工具 ─────────────────────────
fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// 稳定的 64 位 FNV-1a 哈希，用作歌曲 id（跨版本不变）
fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:016x}", h)
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn split_list(v: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in v {
        for part in s.split(|c: char| c == ';' || c == '；' || c == '、') {
            for p in part.split(" / ") {
                let p = p.trim();
                if !p.is_empty() && !out.iter().any(|x| x == p) {
                    out.push(p.to_string());
                }
            }
        }
    }
    out
}

fn save(file: &Path, d: &Data) {
    if let Ok(s) = serde_json::to_string(d) {
        let tmp = file.with_extension("json.tmp");
        if fs::write(&tmp, s).is_ok() {
            let _ = fs::rename(&tmp, file);
        }
    }
}

fn load_data(file: &Path, roaming: Option<PathBuf>) -> Data {
    if let Ok(s) = fs::read_to_string(file) {
        if let Ok(d) = serde_json::from_str::<Data>(&s) {
            return d;
        }
    }
    // 首次启动：迁移 Electron 版的文件夹、黑名单和设置（歌曲会重新扫描）
    let mut d = Data::default();
    if let Some(r) = roaming {
        for name in ["Pulse", "pulse-player"] {
            let old = r.join(name).join("library.json");
            if let Ok(s) = fs::read_to_string(&old) {
                if let Ok(mut o) = serde_json::from_str::<Data>(&s) {
                    if let Some(obj) = o.settings.as_object_mut() {
                        obj.remove("lastSession");
                    }
                    d.folders = o.folders;
                    d.blacklist = o.blacklist;
                    d.playlists = o.playlists;
                    d.settings = o.settings;
                    break;
                }
            }
        }
    }
    save(file, &d);
    d
}

fn decode_text(b: &[u8]) -> String {
    if b.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&b[3..]).into_owned();
    }
    if b.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode(b).0.into_owned();
    }
    match std::str::from_utf8(b) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::GBK.decode(b).0.into_owned(), // 国内常见的 GBK 编码 lrc
    }
}

// ───────────────────────── 扫描 ─────────────────────────
fn read_track(p: &str, folder: &str, size: u64, mtime: f64, prev: Option<&Track>) -> Track {
    let path = Path::new(p);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut t = Track {
        id: fnv(p),
        path: p.to_string(),
        folder: folder.to_string(),
        title: stem.clone(),
        artists: vec!["未知艺术家".to_string()],
        album: "未知专辑".to_string(),
        size,
        mtime,
        added_at: prev.map(|x| x.added_at).unwrap_or_else(now_ms),
        play_count: prev.map(|x| x.play_count).unwrap_or(0),
        last_played: prev.map(|x| x.last_played).unwrap_or(0.0),
        ..Default::default()
    };
    // 文件名兜底：“歌手 - 歌名”
    if let Some((a, b)) = stem.split_once(" - ") {
        t.artists = vec![a.trim().to_string()];
        t.title = b.trim().to_string();
    }
    if let Ok(tf) = lofty::read_from_path(path) {
        let props = tf.properties();
        t.duration = props.duration().as_secs_f64();
        t.bitrate = props.audio_bitrate().unwrap_or(0);
        t.codec = format!("{:?}", tf.file_type());
        if let Some(tag) = tf.primary_tag().or_else(|| tf.first_tag()) {
            if let Some(v) = tag.title() {
                if !v.trim().is_empty() {
                    t.title = v.to_string();
                }
            }
            let mut arts: Vec<String> = tag.get_strings(&ItemKey::TrackArtist).map(|s| s.to_string()).collect();
            if arts.is_empty() {
                if let Some(a) = tag.artist() {
                    arts.push(a.to_string());
                }
            }
            let arts = split_list(&arts);
            if !arts.is_empty() {
                t.artists = arts;
            }
            if let Some(v) = tag.album() {
                if !v.trim().is_empty() {
                    t.album = v.to_string();
                }
            }
            if let Some(v) = tag.get_string(&ItemKey::AlbumArtist) {
                t.album_artist = v.to_string();
            }
            let genres: Vec<String> = tag.get_strings(&ItemKey::Genre).map(|s| s.to_string()).collect();
            t.genres = split_list(&genres);
            t.year = tag.year();
            t.track_no = tag.track();
            t.disc_no = tag.disk();
        }
    }
    t
}

fn scan(app: &AppHandle) -> Option<Vec<Track>> {
    let st = app.state::<AppState>();
    {
        let mut s = st.scanning.lock().unwrap();
        if *s {
            return None;
        }
        *s = true;
    }
    let (folders, old): (Vec<Folder>, HashMap<String, Track>) = {
        let d = st.data.lock().unwrap();
        (d.folders.clone(), d.tracks.iter().map(|t| (t.path.clone(), t.clone())).collect())
    };
    let mut files: Vec<(String, String)> = Vec::new();
    for f in &folders {
        for e in WalkDir::new(&f.path).into_iter().filter_map(|e| e.ok()) {
            if e.file_type().is_file() && is_audio(e.path()) {
                files.push((e.path().to_string_lossy().to_string(), f.path.clone()));
            }
        }
    }
    let total = files.len();
    let _ = app.emit("scan-progress", json!({ "done": 0, "total": total }));
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(total);
    for (i, (p, folder)) in files.into_iter().enumerate() {
        if seen.insert(p.clone()) {
            if let Ok(meta) = fs::metadata(&p) {
                let size = meta.len();
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);
                match old.get(&p) {
                    // 增量：大小和修改时间都没变就直接复用
                    Some(t) if t.size == size && t.mtime == mtime => {
                        let mut t = t.clone();
                        t.folder = folder;
                        out.push(t);
                    }
                    prev => out.push(read_track(&p, &folder, size, mtime, prev)),
                }
            }
        }
        if (i + 1) % 20 == 0 || i + 1 == total {
            let _ = app.emit("scan-progress", json!({ "done": i + 1, "total": total }));
        }
    }
    {
        let mut d = st.data.lock().unwrap();
        d.tracks = out.clone();
        save(&st.file, &d);
    }
    *st.scanning.lock().unwrap() = false;
    Some(out)
}

// ───────────────────────── 封面 / 歌词 ─────────────────────────
fn embedded_picture(p: &str) -> Option<Vec<u8>> {
    let tf = lofty::read_from_path(p).ok()?;
    for tag in tf.tags() {
        let pics = tag.pictures();
        if let Some(pic) = pics.iter().find(|x| x.pic_type() == PictureType::CoverFront).or(pics.first()) {
            return Some(pic.data().to_vec());
        }
    }
    None
}

fn dir_cover(p: &str) -> Option<Vec<u8>> {
    let dir = Path::new(p).parent()?;
    for e in fs::read_dir(dir).ok()?.flatten() {
        let path = e.path();
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        let stem = path.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if ["jpg", "jpeg", "png"].contains(&ext.as_str()) && COVER_NAMES.contains(&stem.as_str()) {
            return fs::read(path).ok();
        }
    }
    None
}

fn load_cover(p: &str, size: u32) -> Option<String> {
    let bytes = embedded_picture(p).or_else(|| dir_cover(p))?;
    let img = image::load_from_memory(&bytes).ok()?;
    let img = if img.width() > size { img.resize(size, size * 4, image::imageops::FilterType::Triangle) } else { img };
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img.to_rgb8()).write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(buf.into_inner())))
}

fn load_lyrics(p: &str) -> Option<String> {
    let path = Path::new(p);
    for ext in ["lrc", "LRC", "txt"] {
        if let Ok(b) = fs::read(path.with_extension(ext)) {
            return Some(decode_text(&b));
        }
    }
    let tf = lofty::read_from_path(path).ok()?;
    for tag in tf.tags() {
        if let Some(l) = tag.get_string(&ItemKey::Lyrics) {
            return Some(l.to_string());
        }
    }
    None
}

// ───────────────────────── 命令 ─────────────────────────
#[tauri::command]
fn lib_get(state: tauri::State<'_, AppState>) -> Value {
    serde_json::to_value(&*state.data.lock().unwrap()).unwrap_or(Value::Null)
}

#[tauri::command]
async fn lib_scan(app: AppHandle) -> Result<Option<Vec<Track>>, String> {
    tauri::async_runtime::spawn_blocking(move || scan(&app)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn folders_add(app: AppHandle) -> Result<Option<Vec<Folder>>, String> {
    let picked = match app.dialog().file().set_title("添加文件夹到音乐库").blocking_pick_folders() {
        Some(v) => v,
        None => return Ok(None),
    };
    let st = app.state::<AppState>();
    let mut d = st.data.lock().unwrap();
    for fp in picked {
        if let Ok(pb) = fp.into_path() {
            let s = pb.to_string_lossy().to_string();
            if !d.folders.iter().any(|f| f.path == s) {
                d.folders.push(Folder { path: s, enabled: true });
            }
        }
    }
    save(&st.file, &d);
    Ok(Some(d.folders.clone()))
}

#[tauri::command]
fn folders_remove(state: tauri::State<'_, AppState>, path: String) -> Value {
    let mut d = state.data.lock().unwrap();
    d.folders.retain(|f| f.path != path);
    d.tracks.retain(|t| t.folder != path);
    save(&state.file, &d);
    json!({ "folders": d.folders, "tracks": d.tracks })
}

#[tauri::command]
fn folders_toggle(state: tauri::State<'_, AppState>, path: String, enabled: bool) -> Vec<Folder> {
    let mut d = state.data.lock().unwrap();
    if let Some(f) = d.folders.iter_mut().find(|f| f.path == path) {
        f.enabled = enabled;
    }
    save(&state.file, &d);
    d.folders.clone()
}

#[tauri::command]
fn state_patch(state: tauri::State<'_, AppState>, patch: Value) -> bool {
    let mut d = state.data.lock().unwrap();
    if let Some(v) = patch.get("blacklist") {
        d.blacklist = v.clone();
    }
    if let Some(v) = patch.get("playlists") {
        d.playlists = v.clone();
    }
    if let Some(Value::Object(new)) = patch.get("settings") {
        if !d.settings.is_object() {
            d.settings = Value::Object(Map::new());
        }
        if let Some(obj) = d.settings.as_object_mut() {
            for (k, v) in new {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    save(&state.file, &d);
    true
}

#[tauri::command]
async fn cover_get(app: AppHandle, path: String, size: u32) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<AppState>();
        let key = format!("{}|{}", path, size);
        if let Some(v) = st.covers.lock().unwrap().get(&key) {
            return v.clone();
        }
        let v = load_cover(&path, size.clamp(64, 1200));
        let mut c = st.covers.lock().unwrap();
        if c.len() > 600 {
            c.clear();
        }
        c.insert(key, v.clone());
        v
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn lyrics_get(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || load_lyrics(&path)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn show_in_folder(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path)).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

#[tauri::command]
fn track_played(state: tauri::State<'_, AppState>, id: String) {
    let mut d = state.data.lock().unwrap();
    if let Some(t) = d.tracks.iter_mut().find(|t| t.id == id) {
        t.play_count += 1;
        t.last_played = now_ms();
    }
    save(&state.file, &d);
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn app_exit(app: AppHandle) {
    app.exit(0);
}

// ───────────────────────── 托盘 / 窗口 ─────────────────────────
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 Pulse", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "播放 / 暂停", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &toggle, &prev, &next, &sep, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Pulse")
        .menu(&menu)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "show" => show_main(app),
            "toggle" | "prev" | "next" => {
                let _ = app.emit("tray-action", ev.id().as_ref().to_string());
            }
            // 交给前端先保存播放进度再退出（前端无响应时 1.5 秒后强制退出）
            "quit" => {
                let _ = app.emit("tray-action", "quit".to_string());
                let h = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    h.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    #[allow(deprecated)]
    {
        tray = tray.menu_on_left_click(false);
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let file = dir.join("library.json");
            let data = load_data(&file, app.path().data_dir().ok());
            app.manage(AppState {
                data: Mutex::new(data),
                file,
                scanning: Mutex::new(false),
                covers: Mutex::new(HashMap::new()),
            });
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口 → 默认隐藏到托盘（设置里可关闭此行为）
            if let WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window
                    .state::<AppState>()
                    .data
                    .lock()
                    .unwrap()
                    .settings
                    .get("closeToTray")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            lib_get,
            lib_scan,
            folders_add,
            folders_remove,
            folders_toggle,
            state_patch,
            cover_get,
            lyrics_get,
            show_in_folder,
            track_played,
            set_tray_tooltip,
            app_exit
        ])
        .run(tauri::generate_context!())
        .expect("Pulse 启动失败");
}
