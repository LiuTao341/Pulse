# Pulse · 本地音乐播放器（Electron）

参考 [Dopamine](https://github.com/digimezzo/dopamine) 的交互与视觉，用 Electron + 原生 JS 实现（不依赖前端框架，无需构建）。

## 运行

```bash
npm install
npm start          # 开发运行
npm run dist       # 打包 Windows 安装包（electron-builder）
```

> 依赖：`electron`、`music-metadata@7`（读取标签 / 封面 / 内嵌歌词）。
> 若未安装 music-metadata，程序仍能运行，但只能从文件名（`歌手 - 歌名.mp3`）解析信息。

## 下载 exe

每次推送到 `main`，GitHub Actions 会在 Windows 上自动打包，并发布到 [Releases](https://github.com/LiuTao341/Pulse/releases)：

- `Pulse-x.y.z-portable.exe`：免安装，双击即用
- `Pulse-x.y.z-setup.exe`：安装版

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
- 系统媒体键 / Windows 媒体浮层（MediaSession）
- 记忆：音量、循环/随机模式、主题色、上次播放队列和进度、播放次数
- 无边框窗口 + 自绘标题栏、单实例运行、快捷键

## 目录结构

```
src/
  main/
    main.js       主进程：窗口、扫描、元数据、封面、歌词、IPC
    preload.js    contextBridge 暴露的安全 API（window.api）
    store.js      JSON 持久化（userData/library.json）
  renderer/
    index.html    界面骨架
    styles.css    设计令牌 + 全部样式
    renderer.js   状态、视图、虚拟列表、播放器
preview/          浏览器预览（模拟 window.api）
docs/
  UI_DESIGN.md    UI 方案
  screenshots/    界面截图
```

## 数据存放

`%APPDATA%/pulse-player/library.json`（Windows）。删除该文件即可重置。
