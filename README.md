# Pulse · 本地音乐播放器（Tauri 2）

参考 [Dopamine](https://github.com/digimezzo/dopamine) 的交互与视觉。界面是原生 HTML/CSS/JS（无框架、无需前端构建），后端用 Rust + Tauri 2，exe 只有几 MB（Electron 版约 75 MB）。

## 运行

需要 Node.js 和 [Rust](https://rustup.rs)。

```bash
npm install
npm run dev        # 开发运行
npm run build      # 打包（exe 在 src-tauri/target/release/）
```

> Rust 依赖：`lofty`（标签/封面/内嵌歌词）、`image`（封面缩略图）、`encoding_rs`（GBK 歌词）、`walkdir`、`tauri-plugin-dialog`。
> 运行需要 WebView2，Windows 10/11 一般已自带。

## 下载 exe

每次推送到 `main`，GitHub Actions 会在 Windows 上自动打包，并发布到 [Releases](https://github.com/LiuTao341/Pulse/releases)：

- `Pulse-x.y.z-portable.exe`：免安装，双击即用
- `Pulse-x.y.z-setup.exe`：安装版

**应用内更新：** 程序启动后会检查 Releases，有新版本时顶栏出现「更新并重启」，点一下即可下载、替换当前 exe 并自动重启（设置 → 关于 里也能手动检查）。发布新版本时记得提升 `package.json` 里的 `version`，否则不会被识别为更新。

在本机打包：双击 `scripts\build-win.bat`，完成后会自动打开 `release\` 文件夹。

**只想看界面？** 直接用浏览器打开 `preview/index.html`（内置模拟数据，不需要 Electron）。

## 已实现功能

- 音乐库：添加 / 移除 / 勾选隐藏文件夹，递归扫描（增量：未修改的文件不重复解析），扫描进度
- 支持格式：mp3 / flac / wav / ogg / opus / m4a / aac / webm
- 浏览：艺术家、专辑（网格 + 详情）、文件夹（逐级浏览）
- 搜索：歌名 / 歌手 / 专辑
- 播放：播放/暂停、上/下一首、拖动进度、音量/静音、随机、列表循环/单曲循环、播放队列（下一首播放 / 加入队列 / 移除 / 跳转）
- 黑名单：加入/移出/清空，播放时自动跳过
- 正在播放页：模糊封面背景 + 大封面 + 滚动歌词（同名 .lrc 或内嵌歌词，支持 GBK，点击跳转）
- 封面：内嵌封面优先，回退到目录下的 cover/folder.jpg；主进程缩放后缓存
- 无缝播放 / 交叉淡入淡出（0–12 秒可调），对数音量
- 方案 B「封面沉浸」界面：左侧图标导航、背景跟随当前封面、毛玻璃面板
- 应用内更新：检测 GitHub 新版本，一键下载替换并重启
- 关闭窗口缩到系统托盘（托盘菜单：播放/暂停、上一首、下一首、迷你播放器、退出）；第一次关闭时询问缩到托盘还是退出
- 耳机柔和模式：响度均衡（ReplayGain）、高频柔化、声道交叉馈送、软限幅（Web Audio，经自带 CORS 的本地 media:// 协议加载音频）
- 迷你播放器：380×84 置顶小窗，可在设置中关闭
- 系统媒体键 / Windows 媒体浮层（MediaSession）
- 记忆：音量、循环/随机模式、主题色、上次播放队列和进度、播放次数
- 无边框窗口 + 自绘标题栏、快捷键

## 目录结构

```
src-tauri/
  src/main.rs     后端：扫描、标签、封面、歌词、持久化、托盘、关闭到托盘
  tauri.conf.json 窗口 / 资源协议 / 打包配置
  capabilities/   前端可用权限
src/renderer/
  index.html      界面骨架
  styles.css      设计令牌 + 全部样式
  tauri-api.js    把 Rust 命令包装成 window.api
  renderer.js     状态、视图、虚拟列表、播放引擎
preview/          浏览器预览（模拟 window.api）
docs/
  UI_DESIGN.md    UI 方案
  screenshots/    界面截图
```

## 数据存放

`%APPDATA%\app.pulse.player\library.json`。首次启动会自动导入 Electron 版的文件夹、黑名单和设置。删除该文件即可重置。
