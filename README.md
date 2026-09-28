# MdReader · Markdown 阅读器

一个 Markdown 阅读器，**同一套代码出两个形态**：浏览器里能直接打开的单文件网页，
以及一个 Windows 桌面程序。

设计取向是「**读**」优先 —— 排版、主题、目录、阅读节奏都围绕长时间阅读来调，
编辑能力（源码模式 / 所见即所得风格模式）作为附带。

---

## 特性

### 阅读

- **16 套风格**，逐套手调，不是换个色号：`AutoCLAW` / `Codex` / `Claude` / `Qoder` /
  `WorkBuddy` / `Antigravity` / `ZCode` / `OpenCode` / `VSCode` / 三种终端形态
  （`grok` / `Claude Code` / `Gemini CLI`）等，每套有自己的字体栈、行高、限宽、圆角与强调色
- **目录（大纲）**：从渲染结果里抽取标题，层级缩进、滚动自动高亮、点击平滑跳转
- **分栏对照**：源码与预览左右联动滚动，分隔条可拖动、双击复位
- **数学公式**：KaTeX（除终端形态外）
- **代码高亮**：rehype-highlight，自动识别语言
- **GFM**：表格、任务列表、删除线、自动链接；另支持 `:::card` 结构化卡片语法

### 编辑

- **源码模式**：CodeMirror 6，带行号与括号匹配
- **风格模式**：所见即所得，直接改渲染后的样子；`Ctrl+B / I / U / E` 加粗、斜体、下划线、行内代码
- **多文档标签**：桌面端标签在**原生标题栏**上，浏览器端在页面顶栏
- 脏标记、`Ctrl+S` 保存、另存为

### 桌面端（Windows）

- 原生标题栏与窗口按钮（Wpf.Ui），配色跟随当前风格**实时同步**
- 文件关联（可选，写 HKCU，便携不污染系统）
- 最近打开 + 任务栏跳转列表
- 关闭时若有未保存改动会询问；下次启动恢复上次打开的文件
- 拖入文件直接打开；`MdReader.exe a.md b.md` 一次开多个

---

## 快速开始

### 浏览器版

直接用浏览器打开 `release/md-reader.html` 即可（单文件，无依赖、无需联网）。

### 从源码构建

需要 Node.js 20+ 与 .NET 10 SDK（桌面端）。

```bash
npm install
npm run smoke           # 渲染管线自测（SSR）
npm run build:desktop   # -> dist/index.html，并复制到 desktop/Assets/reader.html
```

只想要网页：

```bash
npm run build           # -> dist/index.html
```

桌面端：

```bash
dotnet publish desktop -c Release -r win-x64 --self-contained false -o publish
```

> 发布到非默认目录时注意：`dotnet` 需要 `APPDATA` / `PROGRAMFILES` / `PROGRAMDATA`
> 等环境变量，否则 NuGet 会报 `Value cannot be null (Parameter 'path1')`。

---

## 项目结构

```
src/
  app.jsx          主界面：多文档、顶栏、标签、目录、日志、弹窗
  styles.css       16 套风格的全部样式（CSS 变量驱动）
  rich.js          风格模式编辑器的渲染管线
  sample.js        内置示例文档
  schema.js        sanitize 白名单
  log.js           运行日志
desktop/
  mainwindow.xaml      原生标题栏 / 标签 / 菜单
  mainwindow.xaml.cs   文件 IO、消息通道、系统集成、会话
  Assets/reader.html   构建产物（由 build:desktop 复制）
docs/
  AGENT-MD-RENDERING.md   各 AI 编程工具 Markdown 渲染形态的实测记录
  native-migration.md     「只留渲染用 WebView」的架构与分期方案
scripts/            构建辅助
CHANGES.md          逐版变更记录
```

---

## 技术栈

**前端**：React 19 · Vite · react-markdown + remark/rehype（GFM / math / raw / sanitize / highlight）
· KaTeX · CodeMirror 6 · Radix UI（Select / Dialog / Tooltip）· sonner · lucide-react

**桌面**：.NET 10 · WPF · Wpf.Ui · WebView2

**两者之间的边界**：桌面端把网页当**渲染器**用 —— 网页负责 Markdown → HTML 与主题样式，
窗口、标签、文件、系统集成都在 C# 一侧；两侧通过 WebView2 消息通道通信
（`render` / `theme` / `save` / `session` / `openDialog` 等）。
详见 `docs/native-migration.md`。

---

## 主题是怎么做的

所有颜色走 CSS 变量（`--bg` / `--panel` / `--text` / `--muted` / `--border` /
`--accent` / `--accent-soft` …），每套风格只是给这些变量换一组值，
外加自己的字体栈、行高、内容限宽和少量结构修饰。

**桌面端也吃这套变量**：网页把当前风格的色板通过 `theme` 消息发给宿主，
原生标题栏与窗口边带随之更新 —— 所以 16 套风格在原生外壳上同样成立，
不需要把主题在 WPF 里再实现一遍。

---

## 说明

- 仓库**不包含**构建产物与运行时数据（见 `.gitignore`）。
  `MdReader-data/` 里有会话、最近文件与日志，含本机路径，不提交。
- 桌面端数据写在**程序目录内**的 `MdReader-data/`，不往解压目录外写任何东西；
  换个目录解压就等于换一份数据。

## 许可

MIT，见 `LICENSE`。
