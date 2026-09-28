# 改了什么

从**最开始的版本**（`md-reader/` 根目录那份，2026-09-22）出发。

改动一共四组：

1. `desktop/mainwindow.xaml` —— 窗口默认尺寸 + 留出缩放边带
2. `desktop/mainwindow.xaml.cs` —— 默认尺寸收敛 + 重建 `WindowChrome`
3. `desktop/mdreader.csproj` → `desktop/MdReader.csproj` —— **只是改名**（恢复原始文件名，不改它程序起不来）
4. `src/app.jsx` / `src/styles.css` / `src/sample.js` —— 渲染风格从 4 种扩到 **12 种**

除上面列出的文件外，其余文件与原始版本**逐字节相同**（用 `cmp` 逐个核对过）。

## 1. `desktop/mainwindow.xaml`

```diff
-                 Width="1280" Height="840"
-                 MinWidth="860" MinHeight="560"
+                 Width="1120" Height="740"
+                 MinWidth="720" MinHeight="460"
+                 ResizeMode="CanResize"
                  WindowStartupLocation="CenterScreen"
-                 ExtendsContentIntoTitleBar="True"
-                 Background="Transparent">
+                 ExtendsContentIntoTitleBar="True">
 
     <ui:TitleBar Grid.Row="0" Title="Markdown 阅读器" />
 
+    <!-- Margin 留出 6px 边带交给 WPF 处理边缘缩放，必须与 MainWindow.ResizeBandDip 一致 -->
     <wv2:WebView2 Grid.Row="1"
                   x:Name="Web"
+                  Margin="6"
                   DefaultBackgroundColor="Transparent" />
```

- **默认尺寸 1280×840 → 1120×740**，最小尺寸 860×560 → 720×460。1080p @150% 缩放下，
  原尺寸的物理尺寸达 1920×1260，窗口会被挤到 `(0,-84)`，顶部 84px 跑到屏幕外。
- **WebView2 加 `Margin="6"`**：这是"能拖拽缩放"的关键，原因见下。
- **去掉 `Background="Transparent"`**：留出 6px 边带后，那一圈会露出来；窗口背景设为透明时
  露出的部分由 DWM 合成，颜色不受控。交给 Wpf.Ui 自己的窗口背景接管，边带颜色才正常。
- `ResizeMode="CanResize"` 是显式声明（WPF 默认值本来就是它），把意图写进 XAML。

## 2. `desktop/mainwindow.xaml.cs`

```diff
+using System.Windows;
+using System.Windows.Shell;
 
     private const string VirtualHost = "app.local";
+
+    /// <summary>
+    /// 窗口边缘用于拖拽缩放的边带宽度（DIP）。
+    /// 必须与 mainwindow.xaml 中 WebView2 的 Margin 保持一致。
+    /// </summary>
+    private const double ResizeBandDip = 6;
+
     private string? _pendingFile;
@@
         InitializeComponent();
         _pendingFile = openPath;
+        ApplyInitialSize();
         Loaded += async (_, _) => await InitAsync();
     }
+
+    /// <summary>把 XAML 里的设计尺寸收敛到当前屏幕工作区内。</summary>
+    private void ApplyInitialSize()
+    {
+        var work = SystemParameters.WorkArea;
+        Width = Math.Min(Width, Math.Max(MinWidth, work.Width * 0.90));
+        Height = Math.Min(Height, Math.Max(MinHeight, work.Height * 0.88));
+    }
+
+    /// <summary>重建 WindowChrome，把缩放边带从 Wpf.Ui 默认的 4px 提到 6px。</summary>
+    private void ApplyWindowChrome()
+    {
+        WindowChrome.SetWindowChrome(
+            this,
+            new WindowChrome
+            {
+                CaptionHeight = 0,
+                CornerRadius = default,
+                GlassFrameThickness = new Thickness(-1),
+                ResizeBorderThickness = new Thickness(ResizeBandDip),
+                UseAeroCaptionButtons = false,
+            });
+    }
@@
     private async Task InitAsync()
     {
+        ApplyWindowChrome();
+
         var env = await CoreWebView2Environment.CreateAsync(
```

## 为什么"不能拖拽缩放"，以及为什么这样就修好了

WPF 的 `WindowChrome` 实现"无边框窗口边缘可缩放"的办法是：让**顶层窗口**响应 `WM_NCHITTEST`，
在边缘返回 `HTLEFT` / `HTRIGHT` / `HTBOTTOM` / `HTTOP`。

而 WebView2 是一个**铺满客户区的子 HWND**。鼠标落在它身上时，`WM_NCHITTEST` 直接被它接走并
返回 `HTCLIENT`，顶层窗口根本收不到消息 —— 所以左右下三条边完全拖不动。

修法两步，缺一不可：

1. `mainwindow.xaml` 里给 WebView2 留 `Margin="6"`，把窗口四周 6px 让给 WPF 自己；
2. `mainwindow.xaml.cs` 里 `ApplyWindowChrome()` 把缩放边带设成同样的 6px。

**两处数字必须一致**，否则边带要么被 WebView2 吃掉、要么比 WebView2 的留白还宽。

调用时机也有讲究：`ApplyWindowChrome()` 必须放在 `Loaded`（即 Wpf.Ui 的
`OnSourceInitialized` 之后、窗口句柄已创建），否则会被 Wpf.Ui 自己设的 4px 边带覆盖掉。

## 3. `desktop/mdreader.csproj` → `desktop/MdReader.csproj`（只是改名，内容一字未动）

**这一条不是新改动，是把被改坏的名字改回去。** 不改的话程序一启动就崩溃退出。

原始版本里这个工程文件本来叫 `MdReader.csproj`，后来被改名成了小写 `mdreader.csproj`。
MSBuild 的程序集名默认取项目文件名，于是程序集从 `MdReader` 变成了 `mdreader`，
内嵌资源名也跟着从 `MdReader.Assets.reader.html` 变成 `mdreader.Assets.reader.html`。

而 `mainwindow.xaml.cs` 里查的是大写那份：

```csharp
Assembly.GetExecutingAssembly()
    .GetManifestResourceStream("MdReader.Assets.reader.html")
```

`GetManifestResourceStream` **区分大小写**，查不到就抛
`InvalidOperationException("embedded reader.html not found")`。这个异常发生在
`InitAsync()` 里、WebView2 初始化之后，所以表现是**窗口先显示成一片黑，然后崩溃退出**。

判定依据（都在原始目录里，不是我猜的）：

- `desktop/obj/project.assets.json` 里记着 `"projectPath": "...\\desktop\\MdReader.csproj"`、
  `"projectName": "MdReader"`
- `desktop/obj/` 里的中间文件叫 `MdReader.csproj.nuget.g.props` / `.targets`
- `desktop/publish/` 里原始那次构建的产物叫 `MdReader.exe` / `MdReader.dll`
- 反查原始 `desktop/publish/MdReader.dll`，内嵌资源名确实是 `MdReader.Assets.reader.html`

也就是说，原来一直能用的那个 `desktop/publish/MdReader.exe` 是改名之前构建的；
改名之后重新构建出来的 `mdreader.exe` 才会崩。

改回大写名之后，重新构建的产物叫 `MdReader.exe` / `MdReader.dll`，内嵌资源名恢复为
`MdReader.Assets.reader.html`，与代码里的查询字符串一致。

## 4. 渲染风格：4 种 → 16 种，按「桌面形态 / 终端形态」分组

原来的 4 种风格是按**渲染技术栈/产品家族**切的（AutoClaw / VS Code 系 / OpenCode / 终端 CLI），
其中 3 种不对应任何具体 agent。现在改成**一个 agent 一种风格**，下拉框分两组。

### 桌面形态（9）

| # | 风格 id | 标签 | 依据来源 |
| --- | --- | --- | --- |
| 1 | `autoclaw` | AutoCLAW | AutoCLAW 原有视觉（保留未动） |
| 2 | `codex` | Codex | Codex 桌面端实测 DOM |
| 3 | `claude` | Claude | Anthropic 官方品牌规范 |
| 4 | `qoder` | Qoder | **本机 D:/Qoder**（VS Code 底座）+ VS Code Light+/Dark+ 变量 |
| 5 | `workbuddy` | WorkBuddy | **本机 D:/WorkBuddy/resources/app.asar** 的 `.cb-markdown` |
| 6 | `antigravity` | Antigravity | Antigravity 2.11.0 更新日志（Darcula 预设） |
| 7 | `zcode` | ZCode | **本机 D:/ZCode/resources/app.asar** 的 Tailwind Typography `.prose` |
| 8 | `opencode` | OpenCode | **本机 @opencode-aidesktop/resources/app.asar** 的 Radix 色板 |
| 9 | `vscode` | VS Code | VS Code 内置 Markdown 预览（markdown-it） |

### 终端形态（7）

| # | 风格 id | 标签 | 依据来源 |
| --- | --- | --- | --- |
| 10 | `terminal` | 通用终端 | 通用 ANSI 终端（One Dark） |
| 11 | `codex-terminal` | Codex 终端 | Codex CLI TUI（Rust + Ratatui） |
| 12 | `claude-terminal` | Claude Code 终端 | Claude Code 终端逐 token 映射表 |
| 13 | `grok-terminal` | Grok 终端 | Grok Build CLI 的 `xai-grok-pager` 渲染管线源码解析 |
| 14 | `gemini-terminal` | Gemini CLI | Gemini CLI 官方主题文档（默认 Atom One Dark） |
| 15 | `aider-terminal` | Aider | Rich 官方 Markdown 渲染文档 |
| 16 | `copilot-terminal` | Copilot CLI | GitHub 官方文档（**调色板未公开，配色为近似**） |

### 这一轮把「近似」换成了「实测」

前四种桌面形态的配色之前是查资料估的。这轮直接从**本机已安装的 Electron 应用**里
解出 `app.asar`、抽出真实 CSS 再抄参数，所以现在是实测值：

| 风格 | 之前（估算） | 现在（实测） |
| --- | --- | --- |
| WorkBuddy | 腾讯 TDesign 蓝 + 14px | 正文 **13px**、标题 **1.25/1.125/1em 紧凑递减**、表格 **1px 边框 + 圆角 16px**、**引用块 `all: unset`**（完全不带样式）、VS Code 主题变量（#1e1e1e / #cccccc / #252526 / #3794ff） |
| ZCode | 紫色强调 + 14px | **Tailwind Typography 原版 `.prose`**：正文 1rem/1.75、内容栏 **65ch**、H1 **2.25em/800**、H2 1.5em/700、代码块圆角 6px、底色 gray-800；配色是 Tailwind 默认灰阶（直接抄的 oklch 值） |
| OpenCode | 青绿强调 | **Radix 暖灰阶**：底 #f8f8f8 / #101010、文字 #6f6f6f / #ffffff9e、边框 #00000029 / #ffffff32、强调 #034cff / #9dbefe，外加实测到的 **diff 三色** |
| Qoder | 自造蓝紫 | **VS Code Light+ / Dark+ 真实变量**（editor.background / sideBar.background / textLink.foreground 等） |

### 四种终端形态：这轮拿到了**源码级**的精确数据

上一轮这四种还是查资料拼的。这轮直接下源码/二进制拆：

| 风格 | 数据来源 | 拿到什么 |
| --- | --- | --- |
| `grok-terminal` | **Grok Build 源码**（gitcode 镜像，Rust，4125 个文件）<br>`xai-grok-pager-render/src/theme/tokyonight.rs` + `md_style.rs` | 默认主题是 **Storm 不是 Night**（底色 #24283b）；**六级标题各有颜色**：h1 TEAL #1abc9c / h2 BLUE #7aa2f7 / h3 ORANGE #ff9e64 / h4 RED #f7768e / h5 GREEN #9ece6a / h6 MAGENTA #bb9af7，全部加粗；行内代码 #73daca；代码块底 #292e42；引用块/列表/分隔线 #565f89；强调列字符确认是 **`┃`（U+2503）** |
| `gemini-terminal` | **Gemini CLI 官方包**（@google/gemini-cli@0.60.0）的 bundle | Atom One Dark 全部色值 + **32 条 hljs 映射逐条对照**；注意 `AccentYellow` 是 **#e6c07b**（不是常见的 e5c07b）；官方共 **19 套**内置主题 |
| `claude-terminal` | **Claude Code 原生二进制**（108MB，Bun 打包，JS 源码明文） | **72 个语义键 × 4 套主题**全部导出；深色主题：`claude` **#d77757**（Anthropic 品牌橙）、`permission` **#b1b9f9**、`text` #ffffff、`success` #4eba65、`error` #ff6b80、`warning` #ffc107、diff 底色 #225c2b / #7a2936 |
| `aider-terminal` | **Aider 0.86.2 源码** + **Rich 15.0.0 源码** | Aider 自定义了 `NoInsetMarkdown`：**H1 被包在 `box.HEAVY` 重边框 Panel 里**；Rich 默认 markdown 样式全表：H2 magenta+下划线、H3 magenta+加粗、H4 magenta+斜体、H5 斜体、H6 dim、**行内代码加粗+cyan+黑底**、代码块 `padding=(1,0)` + Pygments "default"、引用块 magenta、列表 cyan、表格边框 cyan |

> 唯一仍是近似的只剩 `copilot-terminal`：它的原生二进制里只有 6 个 hex 色值，说明配色大部分走
> **ANSI 具名色**而非固定 RGB，官方也没公开完整调色板。这条已在代码注释里标明。

### 编辑器加了「源码 / 风格」两种模式，风格模式是完全渲染后的所见即所得

顶栏在「编辑 / 分栏 / 阅读」旁边多了一个小开关（只在编辑器可见时出现）：

- **源码**（默认）—— 原来的 CodeMirror，Markdown 记号照原样显示，行为与以前完全一致。
- **风格** —— **编辑区就是渲染后的样子**，字号、分割线、表格、代码块、公式与预览**完全一致**，
  可以直接在上面改。

「风格」模式的实现方式：编辑区是一个 `contentEditable`，里面装的**正是预览那条渲染管线
（remark-gfm + remark-math + rehype-raw/sanitize/katex/highlight）产出的 HTML**，
并且**直接复用预览的 `preview` class** —— 所以不是「模仿得像」，而是同一套 CSS 在起作用。
内边距也通过把各风格的 `.pane.preview` 选择器扩充成 `.pane.preview, .rich-editor` 来对齐。

编辑时的加粗 / 斜体 / 下划线走浏览器原生富文本命令：

| 操作 | 快捷键 | 工具栏 |
| --- | --- | --- |
| 加粗 | `Ctrl+B` | **B** |
| 斜体 | `Ctrl+I` | *I* |
| 下划线 | `Ctrl+U` | U |
| 删除线 | — | ~~S~~ |
| 行内代码 | `Ctrl+E` | `<>` |

改动通过新增的 `src/rich.js`（HTML → Markdown 序列化）写回源码：

- 覆盖标题 / 段落 / 加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 围栏代码块 / 列表（含嵌套与
  GFM 任务列表）/ 引用块 / 表格 / 链接 / 图片 / 分隔线
- **公式无损往返**：从 KaTeX 的 `<annotation encoding="application/x-tex">` 里把原始 LaTeX 取回来，
  行内 `$…$` 与块级 `$$…$$` 都能还原
- **rich-\* 结构化积木整体原样保留 HTML**（应用开了 `rehype-raw`，能原样再渲染回来）
- 行内文本里的 `\` `` ` `` `*` `_` 会转义，保证往返一次语义不变

> 因为编辑区与预览共用同一套 CSS，所以**换风格时编辑区的外观会立刻跟着变** ——
> 选「Claude Code 终端」时行内代码就是 `#b1b9f9` 无底色，选「Aider」时行内代码就是
> 青色加粗带黑底，选「ZCode」时行内代码只换色不加底色。

> 之前那版「藏起 Markdown 记号」的做法（CodeMirror + `Decoration.replace`）已经**整体移除**，
> 连同它的 `.cm-md-*` 样式一起删掉了，不留死代码。

### 顶栏调整：源码/风格开关左移 + 新增「另存为」

- `源码 / 风格` 开关移到了 `编辑 / 分栏 / 阅读` 的**左侧**（原来在右侧）。
- 新增**另存为**按钮（在「保存」右边）：
  - 桌面端：调 `PickSavePath` 重新选路径，然后写入，并更新当前文件名与路径。
  - 浏览器：优先用**文件系统访问 API**（`showSaveFilePicker`，能真正选路径和文件名）；
    不支持时退回下载。用户取消（`AbortError`）不算失败，不会静默变成下载。

### 分栏加了可拖动的分隔条

分栏中间现在是一条 6px 的分隔条：

- **按住左右拖** 调整左右比例，夹在 15%~85% 之间（免得某一侧被拖没）
- **双击** 复位成 1:1
- 悬停/拖动时分隔条变成强调色

实现：`--split` 变量 + `.mode-split .pane.editor { flex: 0 0 var(--split) }`，
拖动时在 `window` 上监听 `mousemove` / `mouseup`，按 `.body` 的 `getBoundingClientRect()` 算比例。

### 修掉「除 AutoCLAW 外阅读模式占不满窗口」

**根因**：`.pane.preview` 这个元素**自己就带 `preview` class**，而各风格的
`max-width: 736px / 720px / 860px / 780px / 900px / 65ch / 820px / 980px / 960px`
是写在 `.app.style-X .preview { … }` 上的 —— 于是 `max-width` 直接加在了**面板**上，
面板被限宽并 `margin: 0 auto` 居中，两侧露出底色。AutoCLAW 没有这条规则，所以只有它正常。
（vscode 那条更直接：`max-width` 就明写在 `.pane.preview` 上。）

**修法**：把 `max-width` / `margin: 0 auto` 从 `.preview` 挪到**内容容器**上：

- 预览区新增一层 `<div className="preview-body">`，宽度限制挂在它身上 → 面板始终铺满
- 「风格」模式的编辑区 `.rich-editor` 同样挂这条限制，两边列宽一致
- 内边距与底色改挂到 `.pane.editor.editor-styled`（风格模式下的编辑器面板），
  与预览区结构完全对齐

一共挪了 **10 条** `max-width` 规则（8 个桌面风格 + vscode + 三种终端共享那条）。

### 「风格」模式与阅读模式的渲染方式不一致（根因 + 修复）

> 前一版把这里判断成「编辑区被限宽所以占不满」，然后**去掉了编辑区的限宽** —— 那是误判，
> 已回退。真正的根因是**两条路径的 DOM 结构不一样**。

**先比代码**：两条路径用的渲染管线**逐字相同**（`remarkGfm` + `remarkMath` + `rehypeRaw` /
`rehypeSanitize` / `rehypeKatex` / `rehypeHighlight`），所以产出的 HTML 一致
（实测 diff 只差属性序列化顺序：`disabled="" type="checkbox"` vs `type="checkbox" disabled=""`）。

**差异在 DOM 结构**：

| | 阅读模式 | 风格模式（修复前） |
| --- | --- | --- |
| 外层 | `.pane.preview` ← **带 `preview` class** | `.pane.editor.editor-styled` ← **不带** |
| 内容层 | `.preview-body` | `.rich-editor` ← **却带着 `preview` class** |

**`preview` 这个 class 挂错了元素** —— 阅读模式挂在**面板**上，风格模式挂在了**内容盒子**上。
后果（浏览器实测 `getComputedStyle`）：

| | 阅读模式 | 风格模式（修复前） |
| --- | --- | --- |
| 面板 `font-size` | 13px | **16px**（掉回浏览器默认） |
| 面板 `line-height` | 22.75px | **normal** |
| 内容栏 `max-width` | 736px | **none**（`.preview-body` 的规则命不中） |

**修法：让风格模式的 DOM 与阅读模式完全对齐。**

- 风格模式下面板也带 `preview` class → `.pane.editor.editor-styled.preview`
- 编辑区的内容层改用 `preview-body` → `.preview-body.rich-editor`
- 于是字号、行高、内边距、底色、分割线、表格、**内容栏宽度**全部走同一批 CSS，
  不需要任何「模仿」；`.rich-editor` 只负责 contentEditable 那部分

**实测验证**（窗口 1800、分栏、Codex）：

| | 面板宽 | 内容宽 | max-width | font-size |
| --- | --- | --- | --- | --- |
| 编辑 | 900 | **736** | 736px | **13px** |
| 预览 | 894 | **736** | 736px | **13px** |

**同时修掉一个连带问题**：编辑面板现在也带 `preview` class，会命中 `.mode-split .pane.preview`
（它在 `.mode-split .pane.editor` 之后、同优先级）→ 编辑面板被改成 `flex: 1 1 auto`，
**分隔条会失效**。改成 `.mode-split .pane.preview:not(.editor)` 后实测分栏比例正常
（`--split: 32%` → 编辑 400px / 预览 844px）。

> 教训：**同一个 class 被两个不同角色复用时，先确认它挂在哪一层。**
> `.pane.preview` 自己带 `preview` class 这件事，已经连续坑了两次
> （上一次是 `max-width` 加在面板上导致阅读模式占不满）。

### 视觉打磨：按钮与图标

原来的按钮只有 `1px solid var(--border)`，没有阴影、没有过渡；明暗图标是 Unicode 字符 `☀` / `☾`。

- **图标换成 [lucide](https://lucide.dev)**（`lucide-react` 1.47.0，成熟方案）：
  打开 → `FolderOpen`、保存 → `Save`、另存为 → `SaveAll`、明暗 → `Sun` / `Moon`、
  格式工具栏 → `Bold` / `Italic` / `Underline` / `Strikethrough` / `Code`
- **按钮**：`inline-flex` + 图标对齐、圆角 9px、双层阴影（外投影 + 内高光）、
  完整的 `hover` / `active` / `focus-visible` 状态、`transition`
- **主按钮**：渐变底 + 更深的描边 + 按压内阴影
- **分段控件**：外壳带内凹阴影，选中项是「浮起的小卡片」而不是单纯换底色
- **下拉**：hover 变强调色浅底，`focus-visible` 有 2px 描边
- 暗色主题单独一套阴影（把高光反过来，免得按钮在暗底上发灰）
- 用 `color-mix()` 派生中间色，这样 16 个风格各自的强调色都能自动适配

### 原生标题栏收窄 + 与窗口内部配色统一

桌面端窗口原本是「Wpf.Ui 的 `ui:TitleBar`（**48 dip**）+ WebView2」两行叠着，
顶上白占一大条；而且标题栏跟随**系统**主题，应用自己的明暗开关管不到它 ——
切到暗色后会出现「窗口内部是暗的、标题栏还是亮的」。

- **收窄**：`ui:TitleBar` 的 `Height` 从 Wpf.Ui 默认的 48 改成 **32**，
  实测日志确认 `原生标题栏高 32 dip`。
- **配色统一**：新增 `{type:'theme'}` 消息 —— 网页把当前主题与
  `--panel` / `--text` / `--border` 三个颜色发过来，宿主 `ApplyChromeTheme()`
  同时做两件事：
  1. `ApplicationThemeManager.Apply(dark|light)` —— 让窗口按钮那套也跟应用走
  2. 把 `TitleCtl` 的 `Background` / `Foreground` / `BorderBrush` 设成应用的配色

  颜色在网页侧用 `getComputedStyle` 把 CSS 变量解析成 `#RRGGBB` 再发
  （**WPF 的 `ColorConverter` 不认 `rgb()` / `color-mix()`**）。

### 关于「把渲染搬去原生」：评估与分期方案（尚未动工）

**结论先说**：这是一次**重写**，不是一次改动。要诚实说明代价，也需要先确认取舍。

**该用哪些成熟件（不自研）**

| 能力 | 现方案（网页） | 原生方案 |
| --- | --- | --- |
| Markdown 解析 | remark / rehype | **Markdig**（.NET 事实标准） |
| 渲染到界面 | React + CSS | **Markdig.Wpf** → `FlowDocument` |
| 代码高亮 | rehype-highlight | **ColorCode** 或 AvalonEdit 内置 |
| 编辑器 | CodeMirror 6 | **AvalonEdit** |
| 数学公式 | KaTeX | 需另配（MathML / 位图），**这是最大缺口** |
| 外壳 / 主题 | Wpf.Ui + 16 套 CSS | Wpf.Ui（**16 套主题要逐套移植**） |

**能拿到的**

- 启动从「WebView2 冷启动 + 4.6MB 页面」降到原生窗口级，**接近瞬时**
- 包体从 ~11MB 降到 ~2-3MB（去掉 WebView2 运行时依赖与内嵌页面）
- 缩放 / 拖放 / 文件关联这些系统集成不再受 HwndHost 限制，前面那些补丁都可以拆掉

**会失去的**

- **16 套风格要逐套重写成 WPF 样式** —— 这是工作量最大的一块
- **KaTeX 没有等价的原生方案**，数学公式要么降级（MathML，排版差）要么保留一小块 WebView
- 富文本（contenteditable）编辑要换成 RichTextBox，行为差异不小
- 浏览器版（`md-reader.html`）将不复存在

**分期建议**

1. **阶段一**：只读预览换 Markdig.Wpf，编辑区先保留 WebView2 —— 能验证渲染保真度
2. **阶段二**：编辑区换 AvalonEdit（源码模式），富文本模式暂留
3. **阶段三**：主题系统迁移（16 套，可分批）
4. **阶段四**：拆掉 WebView2，去掉所有 HwndHost 补丁

**没有把握的地方**：「完美继承所有功能与图形界面与交互」在阶段三之前做不到 ——
16 套主题和 KaTeX 是硬缺口。建议**先做阶段一验证保真度**，再决定是否继续。

### 为什么「可视宽度」和「判定宽度」不能不一致（根因说明）

**因为这两件事在 Win32 里本来就是同一件事。**

1. 缩放判定由**顶层窗口**处理 `WM_NCHITTEST` 完成
2. `WM_NCHITTEST` 只发给**光标下最深的那个子窗口**
3. WebView2 是独立子 HWND、盖住客户区，它自己回 `HTCLIENT` → 父窗口永远收不到
4. WPF 的命中测试**穿不过 HwndHost 子窗口**（airspace 问题）

所以：

> **「WPF 能收到鼠标的区域」≡「WebView2 没画到的像素」≡ 可视边带**

**两者是同一个集合**，改一个必然改另一个 —— 这就是为什么"留边距换缩放"必然留下可见边带。

**唯一能真正解耦的路**：让 WebView2 铺满（可视 0），在 `WM_NCHITTEST` 到达 Chromium
之前拦下来 —— 装窗口过程子类，边缘返回 `HTTRANSPARENT` 让消息上浮给父窗口。

**我试了两次都没成**，最可能的原因：**Chromium 会重建它的子窗口**（导航、尺寸变化时），
钩子随之丢失。要修就得在 `WM_SIZE` 时**重新装钩子**。

**当前取舍**：`ResizeBandDip = 4` + `WebView2.Margin="4,0,4,4"` —— 缩放可靠优先。
4px 在视觉上已经很细，配合边带跟随 `--bg`，多数情况下看不出接缝。

### 修会话恢复被清空 + 钩子漏装内层窗口 + 标题改回 M↓ + 关于版面

**1. 会话恢复失败的真正原因：自己把存档清空了**

网页**一加载就会上报一次** `session`（那时只有内置示例，文件列表是空的）——
宿主老老实实把它写进 `session.json`，于是**上次存的记录被空列表覆盖**。
所以现象是「第一次能恢复，之后就永远不行」。

修法：加一个 `_sessionReady` 门 —— 恢复流程走完（`InitAsync` 末尾）之前，
网页的 `session` 上报一律忽略。

**2. 缩放钩子漏装了内层窗口**

之前按类名过滤只装 `Chrome_WidgetWin*`。但 Chromium 里**光标下那个往往是内层的
`Chrome_RenderWidgetHostHWND`** —— 它没被 hook，返回 `HTCLIENT`，缩放照样失效。
改成**所有后代窗口都装**（`EnumChildWindows` 本身是递归的），日志里会打装了几个。

**3. 标题改回 `M↓`**

**4. 「关于」给一个真正的版面**

不再是几行纯文本：左侧大图标 + 右侧「名称 / 版本」，下面一个圆角底纹的信息表
（程序位置 / 数据目录 / 运行时），键值两列对齐。

### 缩放钩子补全 + 会话随时落盘 + 弹窗排版 + 应用图标 + 启动加速

**1. 缩放钩子：要装给所有子窗口**

之前只给 `EnumChildWindows` 找到的**第一个** `Chrome_WidgetWin*` 装了钩子 ——
Chromium 会**嵌套子窗口**，光标下那个未必是它，钩子就形同虚设。
改成遍历时给**所有**匹配的子窗口都装，并在日志里打出装了几个。

**2. 会话恢复不生效**

原来只在关闭流程里写 `session.json` —— 关不干净（进程被杀、异常退出）就丢了。
改成**网页每次文档列表变化就报一次** `{type:'session', files:[…]}`，宿主随时落盘。

**3. 关闭询问弹窗重排**

原来 `Content` 是一整串带 `\n` 的纯文本。改成真正的布局：
标题 + 一个圆角底纹的列表（每条一个 `TextBlock`）+ 询问语，
配色取 Wpf.Ui 的 `TextFillColorPrimaryBrush` / `ControlFillColorDefaultBrush`。

**4. 窗口左上角应用图标**

`ui:TitleBar.Icon` 用 Wpf.Ui 的图标系统（`SymbolIcon DocumentText24`），不自绘。
标题也从 `M↓` 改回「Markdown 阅读器」。

**5. 启动加速**

- **首屏不再同步跑 Markdown**：`renderers` 初值改为 `null`，交给 effect 补 ——
  同步渲染首屏是启动卡顿的主要来源之一
- **页面 HTML 不重复抽取**：`ExtractReaderIfChanged()` 发现目标文件大小与内嵌资源
  一致就直接用，省掉每次启动 4.6MB 的写盘

### 修缩放失效 + 拖放路径回填

**1. 缩放失效 —— 子窗口不能返回缩放码**

上一版我在 **WebView2 子窗口**的 `WM_NCHITTEST` 里直接返回 `HTLEFT` / `HTBOTTOMRIGHT` ——
**这对子窗口毫无意义**，子窗口管不了父窗口的缩放，所以拖不动了。

正确做法是返回 **`HTTRANSPARENT`(-1)**：告诉系统「这次命中别算我头上，继续往下找」，
消息于是交给**父窗口**，由父窗口的 `WindowChrome` 完成缩放。

同时把判定宽度和可视边带**解耦**：

```csharp
ResizeBorderThickness = new Thickness(HitBand);  // 判定 6px（不是 ResizeBandDip=0）
WebView2.Margin = 0;                             // 可视边带 0
```

—— 这才是「可视宽度 0、判定宽度不变」。

**2. 拖放路径回填失败 —— 参数签名不匹配**

宿主是 `window.__dropPath({id, path})`（**一个对象**）这样调的，
而网页侧写的是 `(id, path)`（**两个形参**）→ `path` 拿到 `undefined` → 直接 return ✗。

> 但**菜单「最近打开」里出现了** —— 这条线索说明宿主侧其实**已经拿到路径了**，
> 只是回填给文档那一步断了。改成按对象解构后即通。

### 边带归零 + 关闭确认 + 会话恢复 + 成熟弹窗

**1. 缩放边带：可视宽度 0，判定宽度不变**

之前是给 WebView2 留边距（`ResizeBandDip`）把边缘让给 WPF —— 代价就是露出一圈窗口底色。
现在改成：

- `WebView2.Margin = 0`、`ResizeBandDip = 0` → **可视上完全铺满，没有边带**
- 缩放热区改由**窗口过程子类**提供：`HookWebViewChild()` 用 `EnumChildWindows` 找到
  WebView2 的 `Chrome_WidgetWin*` 子窗口，`SetWindowLongPtr(GWLP_WNDPROC)` 装一层钩子，
  在窗口边缘 `HitBand`(6px) 内直接返回 `HTLEFT` / `HTBOTTOMRIGHT` 等缩放码

> 用 P/Invoke 实现，委托引用存在字段里防止被 GC 回收（否则崩）。
> 装钩子失败时只记日志、退回默认，不会影响其它功能。

**2. 关闭时询问保存 + 会话恢复**

- 关窗口时 `OnClosing` 先 `Cancel`，调 `QuerySessionAsync()` 问网页
  「哪些文档没保存、打开了哪些文件」
- 有未保存的 → 弹 **`Wpf.Ui.Controls.MessageBox`**（成熟控件，主题一致）：
  **保存并关闭 / 不保存 / 取消**；选保存会调 `window.__saveAll()` 写回磁盘
- 无论选什么，都把打开的文件路径写进 `MdReader-data\session.json`；
  **下次启动（命令行没给文件时）自动恢复这些文档**

**3. 「关于」改用成熟弹窗**

原来是系统 `MessageBox`（风格和 Wpf.Ui 完全不搭）。改用
`Wpf.Ui.Controls.MessageBox` + `ShowDialogAsync()`，顺带把程序位置也显示出来。

**4. 内置示例给具体位置**

显示「内置示例（编译在程序内，非磁盘文件）；程序位置 …」——
宿主在配色同步时把 `Environment.ProcessPath` 注入 `window.__exePath`。

**5. 拖放：换用 WebView2 的正规 API**

`postMessage` 传 File 改成 **`postMessageWithAdditionalObjects(msg, [f])`**
（WebView2 专门用来传 File 等对象的 API），并在宿主日志里打出
`AdditionalObjects=N` 便于下次定位。

### 拖放路径（同步发消息）+ 示例文档措辞 + 边带收窄 + 标题栏菜单按钮

**1. 拖放仍拿不到路径 —— 时序问题**

`File` 对象放进 `postMessage` 是对的，但我把它放在 `FileReader.onload` 里发 ——
**拖放事件一结束 `File` 就失效了**，那时宿主拿到的 `AdditionalObjects` 是空的。
改成**在 drop 事件的同一个事件循环里同步发出**：

```js
const id = addDoc({ name: f.name, text: '' })          // 先建文档占位
wv.postMessage({ type:'dropFile', docId: id, file: f }) // ← 同步发，不能等 onload
const reader = new FileReader()                         // 内容稍后异步补上
reader.onload = () => setDocs(ds => ds.map(d => d.id === id ? { ...d, text: … } : d))
```

**2. 内置示例文档不该说「尚未保存到磁盘」**

初始文档打上 `sample: true`，位置一栏显示 **「内置示例，未关联磁盘文件」**；
任何通过「打开 / 拖入 / 命令行」进来的文档都是 `sample: false`，走原来的文案。

**3. 边带：改回跟随底色，并把宽度 6 → 4**

上一版设成 `Transparent` 是**反效果** —— 透明会露出 Wpf.Ui 的窗口底色，仍是异色边框。
改回「根 Grid + 窗口底色都跟着 `--bg`」，并把 `ResizeBandDip` 从 6 收到 **4**
（`WebView2.Margin` 同步改成 `4,0,4,4`，这两个值必须一致）。

**4. 标题栏菜单按钮**

`ui:TitleBar` 自己吃掉了右键，所以标题栏上的 `ContextMenu` 不弹了。
按要求**不还原右键**，改成在 `TrailingContent` 放一个**菜单按钮**
（`ui:Button` + `SymbolIcon Settings24`），点它弹出同一个原生菜单。

### 风格模式滚动条（真因）+ 拖放改走平台 API + 边带透明

**1. 风格模式滚动条没贴右侧 —— 真因找到了**

对比「阅读模式正常、风格模式不正常」这个线索：阅读模式里**滚动的是面板本身**
（`.pane.preview`），限宽盒只是里面的内容 → 滚动条永远在面板右边缘 ✓。
而风格模式里滚动的是 `.rich-editor` —— **它的 class 是 `preview-body rich-editor`**，
于是继承了各风格的：

```css
.app.style-codex .preview-body { max-width: 736px; margin: 0 auto; }
```

→ 它变成一个**限宽居中的盒子**，滚动条跑到盒子右边而不是面板右边 ✗。

修法（**注意优先级**）：`.app.style-X .preview-body` 是 3 个类，所以覆盖也写 3 个类，
并放在样式表**最后**，靠源码顺序取胜：

```css
.app .preview-body.rich-editor { max-width: none; margin: 0; }
```

> 第一版我写成 `.rich-editor { max-width: none }`（1 个类），**优先级不够，没生效**。
> 实测（codex 风格，1250px 宽）：改前编辑器 `[257, 993]`、右侧差 257px；
> 改后 `[0, 1250]`、**右侧差 0** ✓。
> 之前用 AutoCLAW 风格量不到问题，是因为**它没有限宽规则**。

**2. 拖放光标是禁止圈 —— 换回平台正路**

关掉 `AllowExternalDrop` 让 WPF 接拖放这条路，光标会变成禁止圈。
**改回 `AllowExternalDrop = true`**（光标正常），磁盘路径改走 WebView2 的正规通道：
把 `File` 对象放进 `postMessage`，WebView2 会还原成 **`CoreWebView2File`（带 `Path`）**，
从 `args.AdditionalObjects` 取出来回填给网页。

```
JS   wv.postMessage({ type:'dropFile', docId, file: f })
C#   args.AdditionalObjects → CoreWebView2File.Path → window.__dropPath(docId, path)
```

**3. 缩放边带改透明** —— 根 `Grid` 与窗口的 `Background` 都设为 `Transparent`，
那圈 6px 透出窗口自身背景，不再是异色边框。

### 修上一批引入的 4 个问题

**1. 拖动显示「禁止」光标** —— 我上一批只把 `AllowDrop` 挂在了根 `Grid` 上，
而关掉 `AllowExternalDrop` 后，拖放事件落到 WPF 这一层时，**光标下最上层的 WPF 元素是
WebView2 自己**（它默认 `AllowDrop=false`）→ WPF 不再往上路由 → 效果为 None → 禁止光标。
**修法**：把 `AllowDrop` / `DragOver` / `Drop` 也挂到 **WebView2 元素本身**上。

**2. 标题栏窗口按钮没有悬停反馈** —— 我上一批把 `ui:TitleBarButton` 单独放在自己的
`StackPanel` 里。**它的悬停 / 按下样式依赖 `ui:TitleBar` 提供的上下文**，
独立使用就没有反馈。**修法**：标题栏直接用 **`ui:TitleBar` 当容器**（不再自己拼 Grid），
文档标签放进它的 `Header` 区。这样一次拿到：三个按钮（含悬停 + 自动窗口动作）、
拖拽、双击最大化、系统菜单 —— 连 `Click` 处理器都不用挂。

**3. 标签上的叉号太大** —— 原来是自己拼 `ControlTemplate` + `Segoe MDL2 Assets` 字形。
换成 Wpf.Ui 的 **`ui:Button` + `ui:SymbolIcon Symbol="Dismiss24"`**，字号可控（11）。
`mainwindow.xaml` 里自绘字形**清零**。

**4. 风格模式滚动条没贴窗口右侧** —— **实测这条已经修好了**：
编辑模式（单栏全宽）下面板 `[0,1250]`、编辑器 `[0,1250]`、**右侧到窗口边 0**。
桌面端剩下的那 **6px 是窗口缩放边带**（`ResizeBandDip`，留给 WPF 判拖拽热区，
去掉左右就拖不动缩放了），现在颜色已和窗口内部一致。

### 桌面端不再只是「套壳」：系统集成第一批

方向已明确：**桌面端不必和浏览器版共用同一套逻辑**，哪块能力被网页形式限制，
就把那块下沉到原生。这一批挑了**网页根本做不了**的三件事：

**1. 文件关联（可开关）**
把 `.md` 注册到本程序，写的是 **HKCU**（不需要管理员、便携不污染系统）：

```
HKCU\Software\Classes\.md                                  → MdReader.Markdown
HKCU\Software\Classes\MdReader.Markdown                    → "Markdown 文档"
HKCU\Software\Classes\MdReader.Markdown\DefaultIcon        → "<exe>",0
HKCU\Software\Classes\MdReader.Markdown\shell\open\command → "<exe>" "%1"
```

> ⚠️ 说明清楚：Windows 不允许程序自己抢占**默认**打开方式（`UserChoice` 有哈希保护），
> 所以这里做到的是「让本程序出现在『打开方式』列表里」，用户选一次「始终」才成为默认。
> 取消勾选会把上面几个键删干净。

**2. 最近打开 + 任务栏跳转列表**
最近文件存在 `MdReader-data\recent.json`（最多 12 条，读取时顺手清掉已删除的），
同时用 `System.Windows.Shell.JumpList` 推送到**任务栏右键菜单**。原生能力，网页做不了。

**3. 一次打开多个文档**
`MdReader.exe a.md b.md c.md` → 各开一个标签；
原生对话框（右键菜单里的「打开文件」和网页上的「打开」）都改成 `Multiselect = true`。

**入口**：这些能力挂在**原生标题栏的右键菜单**上（打开文件 / 最近打开 / 关联 .md / 关于），
不新增网页 UI，也符合系统程序的习惯。

### 拖进来的文件也能拿到真实路径 + 标题栏按钮恢复可用

**拖放**：上一版猜「WebView2 会给 `File` 对象带非标准的 `path`」，**猜错了** ——
Chromium 早已移除该属性，WebView2 也没有提供。所以拖进来的文档依然显示「尚未保存到磁盘」。

**改用平台 API**：把 WebView2 的 `AllowExternalDrop` 关掉，让拖放落到 WPF 这一层，
从 `DataFormats.FileDrop` 拿真实路径：

```csharp
Web.AllowExternalDrop = false;          // 构造函数里
// XAML：<Grid x:Name="RootGrid" AllowDrop="True" DragOver="OnFileDragOver" Drop="OnFileDrop">
```

宿主拿到路径后走**同一条** `InjectOpenFileAsync(path)`（和原生对话框、命令行打开共用）。
网页那边收不到 `drop` 事件了，所以宿主处理完调一次 `window.__dropDone()` 把
「松开以打开」的提示收掉。

**标题栏按钮**：换成 `ui:TitleBarButton` 后我删掉了 Click 处理器，以为控件会自己操作窗口 ——
**不会**。它只有放进 `ui:TitleBar` 里才自动接线，独立使用必须自己挂事件，
否则三个按钮点了没反应。已把 `Click="OnMinClick/OnMaxClick/OnCloseClick"` 挂回去。

> **教训**：换「成熟组件」时要确认它的行为边界 —— 是自带行为还是依赖父容器接线。
> 光看控件存在、长得对，不代表行为也对。

### 缩放边带不再露出一圈「外框」

窗口四周那 6px 的可拖拽缩放带，露出的是 **WPF 窗口 / 根 Grid 的底色** ——
它是 Wpf.Ui 的主题色，不跟应用的风格走，所以在深色风格下会看到一圈浅色边，
浅色风格下又对不上。

修法：网页把 `--bg` 也发给宿主（消息里新增 `win` 字段），
`ApplyChromeTheme()` 把它设到 **根 `Grid`（`RootGrid`）和窗口的 `Background`** 上 ——
根 Grid 正好铺满那圈边带，于是边带与窗口内部同色，视觉上就「没有边」了。

### 风格模式的编辑器不再被内边距挤进来

原来 `.pane.editor.editor-styled` 自己带内边距（如 `28px 24px 96px`），
而滚动的是里面的 `.rich-editor` —— 于是**滚动条被内边距挤到离窗口右边 24px 的地方**，
底部也差着 96px，看着像没贴合窗口。

修法：**把内边距从面板挪到滚动容器上** ——
`.pane.editor.editor-styled { padding: 0 }`，
`.preview-body.rich-editor { padding: … }`（每个风格一条，共 10 条 + 终端模式 1 条）。
滚动容器于是铺满整个面板，滚动条贴到面板边缘，内容列宽不变。

**实测**：面板与编辑器矩形完全重合 `[0, 625]`，左右间隙都是 **0**（改前右侧差 24px）。

### 阅读模式补上「目录」（大纲）面板

顶栏加了一个目录开关（`ListTree` 图标，**只在阅读 / 分栏模式下出现** ——
编辑模式没有预览，目录无从谈起）。打开后从**最左侧**推出侧栏：

- **从渲染后的 DOM 里抽取标题**（`h1`–`h6`），不是解析 Markdown ——
  直接解析会把代码块里的 `#` 也算成标题；从 DOM 拿还能保证和预览里看到的完全一致
- 层级用缩进表示（h1 顶格，越深越缩，字号递减）
- **滚动时自动高亮当前小节**（滚动监听 + 比较各标题相对面板顶部的位置）
- **点条目平滑跳转**：预览面板本身就是滚动容器，直接算相对偏移
- 空文档显示「此文档没有标题」；着色同样走应用变量，16 种风格自动适配

**实测**（浏览器 + `eval`）：面板宽 275px、抽出 6 个条目（
`lv1 Markdown 阅读器 · 示例文档` / `lv2 GFM 表格与任务列表` …）、
位于 `main` 左侧；点击第 4 条 → `scrollTop` 从 0 → **799**，高亮同步切到「代码高亮」。

### 标题栏窗口按钮换成 Wpf.Ui 的 TitleBarButton + 切换文档不再卡

**窗口按钮**：原来是自绘的 —— 自定义 `ControlTemplate` + `Segoe MDL2 Assets` 字形
（`E921` / `E922` / `E8BB`），字形大小、悬停/按下状态都得自己调，结果就是「图标太大」。
现在换成 Wpf.Ui 自带的 **`ui:TitleBarButton`**：

```xml
<ui:TitleBarButton ButtonType="Minimize" />
<ui:TitleBarButton ButtonType="Maximize" />
<ui:TitleBarButton ButtonType="Close" />
```

字形、尺寸、悬停/按下状态、以及「对父窗口执行对应动作」全都是控件自带的，
**不用挂事件**（`OnMinClick` / `OnMaxClick` / `OnCloseClick` 三个处理器已删除，
自绘的 `CaptionButton` 样式也一并删掉）。`ToggleMaximize` 保留 —— 标题栏空白处双击要用。

**切换卡顿**：根因是预览的渲染挂在切换的关键路径上。原来 `renderers` 是
`useMemo(() => <ReactMarkdown>…</ReactMarkdown>, [text, style])` —— **同步**跑完整篇文档的
remark/rehype，文档一大就要几十到几百毫秒，把「切文档」和「敲键」一起卡住。

改成 effect + `setTimeout(0)`：

```js
const [renderers, setRenderers] = useState(() => buildPreview(text, style))
useEffect(() => {
  let cancelled = false
  const id = setTimeout(() => { if (!cancelled) setRenderers(buildPreview(text, style)) }, 0)
  return () => { cancelled = true; clearTimeout(id) }
}, [text, style, buildPreview])
```

推迟一个 tick 后，**编辑区和标签先切过去，预览随后补上** ——
切换时 React 要做的只剩「换编辑器内容 + 重画标签」。

**实测**（143 KB 文档、1500 个小节）：切回示例文档 **72ms**（两帧），
切回后预览正确渲染出 5 个 h2。

### 悬停提示换成 Radix Tooltip

原来用的是 HTML 的 `title` 属性 —— 那是**操作系统画的提示框**，配色、字体、圆角
全都不受控，跟应用的 16 种风格完全不搭。换成
[Radix Tooltip](https://www.radix-ui.com/primitives/docs/components/tooltip)
（`@radix-ui/react-tooltip` 1.2.16），**14 处 `title` 全部替换，残留为 0**。

- 封装成一个小 `Tip` 组件：`<Tip label="…"><button …/></Tip>`，
  内部用 `Tooltip.Trigger asChild` 把行为挂到原元素上，不额外包一层 DOM
- 根节点套一个 `Tooltip.Provider`（`delayDuration=400`、`skipDelayDuration=250`），
  同一区域连续悬停时不会每次都等延迟
- **portal 同样进 `.app`**（和其他 Radix 组件一样），否则拿不到风格变量
- 样式用应用变量：`var(--panel)` 底 + `var(--border)` 边框 + 柔和投影 + 小箭头，
  16 种风格自动适配，暗色单独一套投影
- 状态栏的风格说明与属性面板的按钮用 `side="top"`（下方没空间）

**实测**（浏览器 + `eval`）：悬停属性按钮 → 提示文字「文档属性」、
`在app内: true`、底色 `rgb(255,255,255)`=`var(--panel)`、
字色 `rgb(36,41,47)`=`var(--text)`、边框 `var(--border)`、箭头存在。

### 修掉「打开已有文档也显示尚未保存到磁盘」

**根因**：网页的 `<input type="file">` 和拖放拿到的 `File` 对象**不带磁盘路径**
（浏览器安全限制，Chromium 早已移除 `File.path`）。所以文档确实在磁盘上，
网页这边却无从得知，属性面板只能显示「尚未保存到磁盘」。

**修法：桌面端的「打开」改走宿主的原生对话框** —— 只有宿主知道真实路径。

- 新消息 `{type:'openDialog'}` → 宿主弹 `Microsoft.Win32.OpenFileDialog` →
  读取文件 → 调 `window.__openFile(名字, base64, 完整路径)` 把路径一起带过来
- 命令行打开（`MdReader.exe xxx.md`）的 `InjectOpenFileAsync` 同样补上了路径参数
- 拖放：WebView2 会给 `File` 对象带上非标准的 `path`，有就用（`file.path || null`）
- 属性面板的「位置」分三种说法：有路径显示路径；桌面端无路径显示「尚未保存到磁盘」；
  **浏览器**显示「浏览器不提供文件路径」—— 浏览器里本来就拿不到，不该说成「没保存」

### 属性面板去掉「渲染风格」

它不是 md 文档的固有属性（是阅读器的显示设置），按要求删掉。
风格下拉本身的 `title` / `aria-label` 保留。

### 文档标签移进**原生标题栏**（不在窗口内部）

上一版把标签放在了网页顶栏里。按要求改成放在**原生 Windows 标题栏**上 ——
为此把 Wpf.Ui 的 `ui:TitleBar` 换成了**自定义标题栏**：

```
[ M↓ ]  [ 文档1.md × ][ 文档2.md × ][ … ]        [ —  □  × ]
 └拖动┘  └─ 标签：横向滚动 ─┘                      └ 窗口按钮 ┘
```

- 标签用 `ItemsControl` + `DataTemplate`，数据源是 `ObservableCollection<DocTabItem>`
- 点标签 → `ExecuteScriptAsync("window.__switchDoc('id')")`；点 × → `window.__closeDoc('id')`；
  两者都 `e.Handled = true`，免得这次点击冒泡成窗口拖动
- 空白处按住拖动窗口、双击最大化；最小化 / 最大化 / 关闭三个按钮自己实现
  （`Segoe MDL2 Assets` 字形 `E921 / E922 / E8BB`，关闭键悬停变红）
- **配色全部走 `DynamicResource`**：`ChromeBg / Fg / Muted / Border / Accent / AccentSoft / Hover`，
  由 `ApplyChromeTheme()` **替换资源实例**来更新（静态引用拿不到新实例）。
  次要文字与悬停底色都由前景色派生，不用再往网页侧多要颜色
- 网页侧新增 `{type:'docs', list:[{id,label,active}]}` 消息；依赖用「签名」
  （`id:name:dirty|…`）而不是 `docs` 本身 —— 否则每敲一个键就发一条消息
- **桌面端隐藏网页里的标签栏**（`isDesktop` 惰性初始化，避免首帧闪一下），
  浏览器里仍然用网页标签栏 —— 同一件事不做两套 UI

> 自定义标题栏只有 34px 高，标签用了 `TextTrimming="CharacterEllipsis"` + `MaxWidth=150`，
> 名字长了会截断；标签多了横向滚动（滚动条隐藏）。

### 多文档：同时打开多个 md，顶栏标签切换

顶栏文件名原来的位置换成了**标签栏**：每个文档一个标签，带脏标记 `•` 和关闭按钮，
末尾一个 `+` 新建。单个文档时看起来就是一个普通标签 —— 不需要
「1 个文档用文件名、多个用标签」两套 UI。中键也能关标签；标签多了横向滚动
（滚动条隐藏，免得顶栏再冒一条细条）。

**关键重构：`docs` 成为唯一数据源。**

```js
const [docs, setDocs] = useState([{ id, name, text, fsPath, dirty }, …])
const [activeId, setActiveId] = useState('d1')
const activeDoc = docs.find(d => d.id === activeId) || docs[0]
const text = activeDoc.text      // ← 派生出这四个，
const fileName = activeDoc.name  //    所有**读取点**一行都不用改
const fsPath = activeDoc.fsPath
const dirty = activeDoc.dirty
```

于是改动量集中在**写入点**：`setText/setFileName/setFsPath/setDirty` 全部换成
`patchActive({ … })`（重构脚本断言过这 4 个 setter 的残留为 **0**）。
切换文档只是换 `activeId` —— 内容本来就在 `docs` 里，不需要快照/回填。

- 「打开文件」和拖放现在**新增文档**而不是替换当前文档
- 关闭有未保存改动的文档会先确认；关掉最后一个时留一个空文档，不会出现「没有文档」
- **富文本编辑器的坑**：`richDirty` 那个 ref 会让「自己敲过字」时跳过重建，
  换文档时若不重置，编辑器会继续显示上一个文档的内容。
  所以 `switchDoc` / `addDoc` / `closeDoc` 都会把 `richDirty.current = false`，
  并把 `activeId` 加进重建 effect 的依赖。
- **原生标题栏也跟着变**：新消息 `{type:'title', name, dirty}` → 宿主同时设置
  `TitleCtl.Title` 与窗口 `Title`，显示为 `文件名 •`。

**实测**（浏览器 + `eval`）：

| 操作 | 结果 |
| --- | --- |
| 初始 | 1 个标签「示例文档.md」，3,315 字符 |
| `__openFile` 加一个 | 2 个标签，自动激活新文档，32 字符 |
| 点回第一个标签 | 激活正确，**字符数回到 3,315（内容各自保留）** |
| 关掉第二个 | 剩 1 个标签，激活正确 |

顺带删掉了已成死样式的 `.filename`。

### 文档属性面板 + 超长文件名

顶栏文件名**左侧**加了一个属性按钮（`Info` 图标），点开是文档属性。
用 [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)
（`@radix-ui/react-dialog` 1.1.23）—— **在页面内部渲染，不弹新窗口**，
焦点陷阱 / ESC 关闭 / ARIA 都自带；portal 同样进 `.app` 以继承风格变量。

属性项（8 条）：文件名、位置、大小、字符、行数、词数、渲染风格、状态；
文件已落盘时还会多一条**最后修改时间**。

- **大小**分两种：已落盘读磁盘字节数（宿主 `FileInfo`），否则算当前文本的 UTF-8 字节数
  （`TextEncoder`，且只在面板打开时才算，避免大文档白耗）
- **在资源管理器中打开**：新消息 `{type:'reveal'}` → 宿主
  `explorer.exe /select,"路径"`，能直接在资源管理器里**选中**该文件。
  文件还没落盘时按钮置灰并给出原因提示

宿主侧新增两条消息：`stat`（读文件信息）与 `reveal`（资源管理器定位），
回传回调从写死的 `__saveResult` 改成可指定（`Reply(core, json, callback)`）。

**实测**（浏览器 + `eval`）：`弹层在app内: true`、`新窗口: false`、遮罩存在、
8 项属性值正确、未落盘时按钮正确置灰。

#### 超长文件名现在怎么处理

`.filename` 有 `overflow:hidden + text-overflow:ellipsis + white-space:nowrap`，
`.brand` 有 `min-width:0`，所以**超出部分用省略号截断，悬停显示全名**（`title` 属性）。
实测（窗口 1250、文件名 60 字符）：

| 元素 | clientWidth | scrollWidth | 溢出 |
| --- | --- | --- | --- |
| 顶栏 | 1250 | 1250 | 否 |
| 文件名 | 431 | 763 | **是 → 省略号截断** |
| 按钮区 | 719 | 719 | 否（没被挤压） |

另外把 `.brand { flex: 1 1 auto }` / `.actions { flex: 0 0 auto }` 写成显式声明 ——
按钮区本来靠 `min-width: auto` 也不会被压缩，写出来是为了意图明确、防止以后被改坏。

### 去掉标题栏与内容之间的那条横杠

**根因**：WebView2 的 `Margin="6"` 是**四面**的 —— 这个 6px 边带是留给 WPF 处理窗口边缘
缩放的（见 `ApplyWindowChrome()` 的说明），但上边那一份是多余的：窗口上边缘由标题栏
那一行负责，不需要再留。结果标题栏和网页之间就夹了一条 6px 的窗口底色。

- `Margin="6"` → **`Margin="6,0,6,6"`**（上边距归零，左/右/下保留边带）
- `ui:TitleBar` 加 `BorderThickness="0"` —— 分隔线交给网页顶栏那条
  （同一套 `--border` 颜色），免得这里多出一条和内部风格不一致的线

> 确认过 `ApplyWindowChrome()` 里 **`CaptionHeight = 0`**，拖动是靠 Wpf.Ui 的 TitleBar
> 自己做 `DragMove`，不占用网页区域 —— 所以去掉上边距不会产生「点不动的区域」。

> **⚠️ XAML 注释里不能出现 `--`**。我第一版注释写了 `--border`，编译直接报
> `MC3000: An XML comment cannot contain '--'`。写 CSS 变量名时要改成不带双横杠的说法。

**顺带清掉一段死代码**：`mainwindow.xaml.cs` 里原本还有**第二个**
`core.WebMessageReceived` 订阅者（处理已废弃的 `requestTheme`），网页侧早就改成主动推
`theme` 了，留着只是让两个订阅者同时解析同一条消息。已删除，现在全局只有一个订阅者。
同时给 `ApplyChromeTheme()` 加了一条成功日志：

```
[info] 标题栏配色已同步: dark bg=#1e1e1e fg=#d4d4d4 bd=#2d2d2d (应用成功: True/True/True)
```

这样「标题栏没跟上配色」时，直接看日志就知道是哪一步断的。

> 排查记录：有一次后台启动后进程不见了，一度以为是崩溃。
> **查 Windows 事件日志（`Application Error` / `.NET Runtime`）得到 0 条记录**，
> 说明进程是被 shell 结束时一起收掉的，不是应用崩了。
> 结论：**判断「是否崩溃」要查事件日志，别只看进程在不在。**

### 风格下拉换成 Radix Select（原生 `<select>` 的底色问题无解）

**问题根因**：原生 `<select>` 展开后的列表**由操作系统渲染**，CSS 完全管不到 ——
所以列表底色和条目 hover 高亮永远跟我们的主题对不上，
出现「鼠标在列表上和在某条内容上，底色是两种颜色」。

**修法**：换成 [Radix Select](https://www.radix-ui.com/primitives/docs/components/select)
（`@radix-ui/react-select` 2.3.7）—— 成熟的无头组件，键盘导航 / 输入跳转 / ARIA /
滚动 / 定位都自带，样式完全由我们的 CSS 变量控制：

- 触发器：和按钮同一套观感，展开时图标旋转 180°
- 列表：`background: var(--panel)`、`border: 1px solid var(--border)`、圆角 10px + 柔和投影
- 分组标签（桌面形态 / 终端形态）+ 选中项打勾
- **hover 与键盘上下移动共用 `[data-highlighted]` 一个状态**，所以两种操作下底色完全一致

> **⚠️ portal 必须放进 `.app`**：风格变量（`--accent` 等）挂在 `.app.style-X` 上，
> Radix 默认把内容 portal 到 `document.body`，那样就拿不到变量、配色会掉回默认值。
> 传 `container` 时**不能用 `useRef().current`**（实测 Radix 仍渲染到了 body），
> 要用 **callback ref 存进 state**：

```jsx
const [portalHost, setPortalHost] = useState(null)
<div ref={setPortalHost} className={'app style-' + style + …}>   {/* .app 没有 overflow/transform */}
  …
  <Select.Portal container={portalHost ?? undefined}>
```

**实测**（Claude 风格，`getComputedStyle`）：

| | 值 |
| --- | --- |
| `.app` 的 `--accent` | `#d97757` |
| 下拉里的 `--accent` | `#d97757` ✓ 继承成功 |
| 下拉是否在 `.app` 内 | `true` ✓ |
| 列表底色 / 触发器底色 | 都是 `rgb(255,255,255)` = 同一个 `var(--panel)` ✓ |

### 滚动条与分隔条收窄做轻

**滚动条**（原来用浏览器默认的 ~15px 粗条）：

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb {
  border: 2px solid transparent;      /* 8px 轨道里只画出 4px 滑块 */
  background-clip: padding-box;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--muted) 40%, transparent);
}
```

- 用 Chromium 的 `::-webkit-scrollbar` 钩子（本应用实际运行环境就是 Chromium：
  浏览器 + WebView2），**不是自绘控件**，零依赖、零性能开销
- 滑块半透明，`hover` 加深、拖动时变强调色
- Firefox 用标准属性兜底：`scrollbar-width: thin` + `scrollbar-color`
- ⚠️ **两者必须用 `@supports` 隔开**：Chromium 121+ 里只要设了 `scrollbar-width`，
  `::-webkit-scrollbar` 就会被整个忽略

**分隔条**（原来是 6px 实色条，太抢眼）：

- **保留 6px 拖拽热区**（太窄不好拖），但视觉上只画一条 **1px 发丝线**，默认 `transparent` 底
- `hover` / 拖动时线宽变 2px 并转为强调色

实测（浏览器 + `eval`）：滚动条 **8px**、分隔条热区 **6px**、可见线 **1px**、
分隔条底色 `rgba(0,0,0,0)`。

### 侧栏日志面板

顶栏最右（明暗切换右边）多了一个日志按钮（`ScrollText` 图标），点一下从右侧推出侧栏：

- 头部：图标 + 「日志」+ 条数徽标 + 清空 / 关闭
- 正文：等宽字体，每行 `时间 级别 消息`，`error` 红色、`warn` 琥珀色；
  附带的 `extra`（栈、JSON）折叠在下一行
- **实时**：打开时订阅 `log.subscribe`，新日志自动追加并滚到底部；关闭时取消订阅
- 打开时按钮呈激活态（强调色描边）

**着色全部用应用自己的 CSS 变量**，所以 16 种风格下都会跟着变，终端形态下自动是暗色。
布局上把 `main` 包进了一个 `.workarea` 横向容器（`.body` 加 `min-width: 0` 以便收缩），
侧栏是推挤式而不是浮层，不会遮住内容。

**实测**（浏览器 + `eval` 量尺寸）：面板宽 400px、高 517px，正确显示
`16:08:14.551 info 启动自检 {"webview": false, ...}`。

## 保存真正修好了：绕开宿主对象 + 加日志系统 + 换成熟 toast

### 根因（日志系统上线后一次就抓到了）

WebView2 的宿主对象这条路**根本走不通**。实测日志：

```
unhandledrejection | {"remoteObjectId":0,"methodName":"",
  "parameters":{"error":"无效的参数数目。 (0x8002000E)"},"callId":2}
```

`0x8002000E` = `DISP_E_BADPARAMCOUNT`。**只要访问 `hostObjects.host` 这个代理，
WebView2 就会走一次 IDispatch 往返并失败** —— 所以 `await hostBridge.PickSavePath(...)`
直接 reject → 走 catch → 显示「保存失败」，对话框根本没机会弹出来。

> 之前加 `[ComVisible(true)]` + `ClassInterfaceType.AutoDual` 只是让代理「看起来存在」
> （`typeof` 能读到 `"function"`），但**调用照样失败**。这条路放弃了。

### 修法：保存改走 WebView2 的消息通道

```
JS  window.chrome.webview.postMessage({type:'save', name, content})
C#  WebMessageReceived → 弹系统对话框 → 写盘 → ExecuteScriptAsync 回传结果
JS  window.__saveResult(result)  ← 兑现 promise
```

消息通道是 WebView2 官方推荐的双向通信方式，事件本身就在 UI 线程上，弹窗是安全的。
宿主侧在 `NavigationCompleted` 里写 `window.__hostVersion = 2` 作为能力声明，
网页据此决定走哪条路；拿不到就退回宿主对象（旧版 exe），再退回浏览器下载。

**顺带证明通道可用**：日志本身就是走这条通道落盘的，日志能写进文件 = 通道通。

### 一个容易踩的坑：postMessage 别传 JSON 字符串

```js
wv.postMessage(JSON.stringify(obj))   // ❌ WebMessageAsJson 变成「JSON 字符串」
wv.postMessage(obj)                    // ✅ WebMessageAsJson 才是对象
```

传字符串的话宿主侧 `JsonElement.TryGetProperty` 会抛
`requires an element of type 'Object', but the target element has type 'String'`。
宿主侧已兼容两种写法（字符串会再解一层）。

### 提示改成成熟组件：sonner

原来那个红色提示条是自绘的。现在统一用 [sonner](https://sonner.emilkowal.ski/)
（`sonner` 2.0.8）的 `<Toaster />` + `toast.success / toast.error`：

- 成功：`toast.success('已保存', { description: 完整路径 })`
- 失败：`toast.error('保存失败', { description: 具体原因 })`

主题跟随当前风格（终端形态恒为暗色）。

### 新增日志系统（`src/log.js` + 宿主侧落盘）

- **内存环形缓冲**（最近 500 条）+ `console` 输出
- **桌面端经消息通道转发给宿主**，落盘到 `<MdReader-data>/logs/app-YYYY-MM-DD.log`
- **全局兜底**：`window.onerror` + `unhandledrejection` 都记下来
  —— 跨语言桥失败天生是「没有栈的未捕获拒绝」，不捕获就毫无痕迹
- 控制台里 `__mdrLog.all()` 可以看全部日志
- 启动时打一条**自检**：`{webview, hostVersion, protocol}`

**这次就是靠它一次定位到根因的** —— 没有日志的话，`[object Object]` 这种错误根本无从下手。

> 注意：自检**刻意不碰 `hostObjects`**。一碰就会触发上面那个 DISP_E_BADPARAMCOUNT，
> 在启动时留一条没有栈的错误。宿主对象也改成**惰性获取**，只在消息通道不可用时才用。

## 修掉「点另存为没反应」

**根因：`HostBridge` 少了 COM 可见性标记。**

WebView2 的宿主对象是走 **COM IDispatch** 编组的。`AddHostObjectToScript` 在对象不可见时
**不报错**，但 JS 拿到的代理上没有任何方法：

```js
await hostBridge.PickSavePath(...)   // PickSavePath 是 undefined
// → TypeError → 未捕获的 Promise 拒绝 → 界面上什么都没发生
```

这也解释了为什么「打开」正常而「另存为」不动：打开是 C# 调 JS（`ExecuteScriptAsync`
调 `window.__openFile`），不经过宿主对象；保存是 JS 调 C#，正好走这条坏掉的路。
`Ctrl+S` 保存同样受影响。

**修法**：给 `HostBridge` 加上 WebView2 文档要求的两个特性：

```csharp
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public class HostBridge { ... }
```

**顺带让它不再「静默失败」**：

- 宿主对象调用全部包进 `try/catch`，出错就把原因显示出来
- 顶栏加红色提示条「保存失败：…」（原来只 `console.error`，用户完全看不到）
- `downloadText()` 把 `<a>` 挂进文档再点击 —— 游离的 `<a>` 在部分浏览器里不触发下载

## 便携化：运行时数据全部收进解压文件夹

**回答「运行时会在其他文件夹产生数据吗」：改之前会，改之后不会。**

改之前，`desktop/mainwindow.xaml.cs` 里有两处写死 `%LOCALAPPDATA%`：

| 路径 | 内容 | 实测体积 |
| --- | --- | --- |
| `%LOCALAPPDATA%\MdReader\wwwroot\reader.html` | 每次启动从内嵌资源解压出来的页面 | 4.3 MB |
| `%LOCALAPPDATA%\MdReader\WebView2\` | WebView2 用户数据目录（缓存 / cookies / localStorage） | 35 MB |

**改法**：新增 `DataRoot()`，用 `AppContext.BaseDirectory`（即 exe 所在目录）拼出
`MdReader-data/`，`WwwRoot()` 与 WebView2 的 `userDataFolder` 都从这里派生。
里面只有两类**可再生的派生数据**，删掉不影响使用：

```
<解压目录>/
├── MdReader.exe
├── …（其余 dll）
└── MdReader-data/          ← 全部运行时数据，删掉即净
    ├── wwwroot/reader.html
    └── WebView2/
```

exe 所在目录不可写时（例如被放进 `Program Files`）退回 `%LOCALAPPDATA%\MdReader`，
保证程序仍能启动。另外给 `SaveFileDialog` 加了 `RestoreDirectory = true`，
免得把进程当前目录留在用户上次选的位置。

### 实测验证（解压 → 运行 → 比对）

- 解压目录出现 `MdReader-data/`（16 MB：`WebView2/EBWebView/` + `wwwroot/reader.html`）✓
- `%LOCALAPPDATA%\MdReader` 的**文件指纹（367 个文件的时间戳 + 路径）运行前后完全一致** ✓
  —— 证明没有往系统目录写任何东西

### 顺带修掉的打包缺陷

`Compress-Archive` 打出来的 zip，**条目名用的是反斜杠**（如
`runtimes\win-x64\native\WebView2Loader.dll`）。Windows 自带解压能容错，
但 7-Zip / WinRAR / unzip 可能把反斜杠当成文件名的一部分 → `WebView2Loader.dll`
落不到正确的子目录 → **应用起不来**。

改用 Python 的 `zipfile` 打包，条目名统一正斜杠，压缩级别 9。

> **旧的 39 MB（`%LOCALAPPDATA%\MdReader`）不会自动删除** —— 我没有动它，
> 需要的话手动删掉即可：在资源管理器地址栏输入 `%LOCALAPPDATA%\MdReader` 回车，删除。

### 用浏览器实测过

这轮用 `agent-browser`（本机没装 Chrome，用 `--executable-path` 指到 Edge）+ `eval` 直接量
`getBoundingClientRect()` 与 `getComputedStyle()`，上面两张表里的数字就是实测出来的。
注意：daemon 每次命令都要带 `--executable-path`，否则会连到没有浏览器的新 daemon；
`screenshot` 有时会抓到 Edge 自己的起始页而不是被测页面，**量数值比截图可靠**。

### 实现方式

- `src/app.jsx`：`STYLE_GROUPS`（两组共 16 项）+ `STYLES`（扁平化）+ `TERMINAL_STYLES`
  （由终端组自动生成）；下拉框改用 `<optgroup>` 分组渲染；命中终端形态时给 `.app`
  追加 `terminal-mode` 类，CSS 里就不用把 7 个 id 列一遍。
- `src/styles.css`：16 个风格段落。每个风格覆盖一套 CSS 变量，**明 / 暗必须各写一套**——
  `.app.style-X` 的优先级高于 `[data-theme="dark"]`，只写明色会被暗色主题覆盖。
  终端形态恒为暗底。
- `src/sample.js`：示例文档的风格对照表同步更新为 16 行（按分组）。

> 精度说明：仍属近似的只有 `aider-terminal`（结构还原、配色中性近似）与
> `copilot-terminal`（官方未公开调色板）。其余 14 种的结构参数都是实测或官方规范。
> 逐条标注见 [`docs/AGENT-MD-RENDERING.md`](docs/AGENT-MD-RENDERING.md)。

### 顺带修掉的三处与事实不符的地方

1. **删掉了标题的 `# ` 前缀。** 旧「终端 CLI」风格用 `content: "# "` 给标题画 `#`，
   但 Claude Code 恰恰是把 `#` 消费掉、改用加粗/斜体/下划线表现标题。方向反了，已移除。
2. **终端形态恢复代码语法高亮。** 旧实现遇到终端风格会跳过 `rehypeHighlight`，让代码退回纯文本；
   实际 Claude Code 与 Codex 的终端**都有语法高亮**。现在三种终端形态都开高亮，只关 KaTeX。
3. **`strong` / `em` 不再绑死颜色。** 旧的黄 `#f0c674` / 紫 `#b294bb` 是 Tomorrow 主题的配色，
   与 Claude Code 无关（它的 `strong` 只加粗、`em` 只斜体）。Claude Code 终端风格里已按实测还原。

### 终端形态：整个窗口一起变暗

三种终端形态（`terminal` / `codex-terminal` / `claude-terminal`）下，**整个窗口都切到暗色**，
不只是预览区。原因是只让预览区变黑的话，左侧编辑器那半边还是白的，分栏时左白右黑，
比原来的「黑预览 + 白窗口」对比更刺眼。

具体做了两件事：

1. `src/app.jsx`：把 CodeMirror 的 `theme` 从 `theme === 'dark' ? 'dark' : 'light'` 改成
   `theme === 'dark' || forceDark ? 'dark' : 'light'`，其中 `forceDark = TERMINAL_STYLES.has(style)`。
   原来只跟窗口主题走，所以选终端风格时编辑器仍是亮的。
2. `src/styles.css`：`.app` 补上 `background: var(--bg)`（原来没有底色，露出来的是 `body` 的浅色），
   并给终端形态下的 `.cm-editor` / `.cm-gutters` / `.cm-activeLine` 加暗色兜底。

标题栏、状态栏、按钮、下拉本来就走 `--panel` / `--border` / `--text` 变量，这三个风格的变量
已经是暗色，所以自动跟着变。**主题开关本身不受影响**：终端风格下点「☀/☾」不会改变终端底色
（终端本来就是暗底），只是切到非终端风格时会按你选的主题显示。

### 实现方式

- `src/app.jsx`：`STYLES` 列表扩到 12 项；新增 `NO_MATH_STYLES`（三种终端形态不加载 KaTeX）；
  风格 id 加了 `localStorage` 校验（旧版本存过的 id 失效时回落到 `autoclaw`）。
- `src/styles.css`：新增 12 个风格段落。每个风格覆盖一套 CSS 变量（**明 / 暗各一套**——
  因为 `.app.style-X` 的优先级高于 `[data-theme="dark"]`，不显式写暗色变量会被明色覆盖），
  再叠加各自的结构规则。三种终端形态恒为暗底（终端本来就是暗的）。
- `src/sample.js`：示例文档里的风格对照表同步更新为 12 行。

> 说明：少数风格的**配色具体色值**（Codex 桌面端的六级标题色、ZCode 的强调色等）官方未公开，
> 是按实测到的**结构参数**（字号、内容栏宽度、圆角、对齐方式）配的近似色，已在文档里逐条标注；
> 结构参数本身都来自实测或官方规范。

## 构建信息

| 项 | 值 |
| --- | --- |
| 网页端 | `npm run build:desktop` → `dist/index.html`，单文件 4,461,142 字节 |
| 依赖 | 新增 `lucide-react` 1.47.0（图标）；其余未变 |
| 桌面端 | `dotnet publish desktop -c Release -r win-x64 --self-contained false` |
| 桌面端运行环境 | 需要 .NET 10 Desktop Runtime（x64）与 WebView2 Runtime |
| 渲染管线自测 | `node smoke-test.mjs` → ALL PASS（10 项） |
| 三份 HTML 一致性 | `release/md-reader.html`、`desktop/Assets/reader.html`、`dist/index.html` 的 SHA256 完全相同 |
| 离线自包含 | 外链 `src="http` / `href="http` / `url(http` / `src="//` 全部 0 处 |

SHA256：

```
134ce9cafb17d1fe9707d58d2f65214a74eaf45dd2ae3842fa226806bc44326c  md-reader.html
fa802dda8889b37dcc1926b42655890f1290881da6bc0bb0c5b27b83672843fd  MdReader-win-x64.zip
```

## 怎么检验

1. **网页端**：直接双击 `release/md-reader.html`，用浏览器打开即可（已内联全部 CSS/脚本/字体，
   断网可用）。
2. **桌面端**：解压 `release/MdReader-win-x64.zip`，双击里面的 **`MdReader.exe`**（大写 M）。
   - 看窗口是不是完整落在屏幕内（不该有边缘跑到屏幕外）；
   - 用鼠标拖**左边缘、右边缘、下边缘**以及**右下角**，看能不能改变窗口大小；
   - 上边缘是标题栏拖动区（按住拖窗口），这是无边框窗口的既有行为，不是缺陷。
3. **16 种风格**：右上角下拉按「桌面形态 / 终端形态」分两组，逐个切一遍。
   重点看这几处：Claude 的暖米色底与衬线标题、Codex 的窄内容栏（736px）、
   ZCode 的大字号标题（H1 2.25em/800）与 65ch 内容栏、WorkBuddy 的紧凑标题与 16px 圆角表格、
   Antigravity 的 Darcula 暗色（切暗色主题看）、Grok 终端的左侧 `┃` 强调列、
   Gemini CLI 的 Atom One Dark，以及所有终端形态里**标题没有 `#` 号、代码块有语法高亮**。
4. **编辑器的两种模式**：切到「编辑」或「分栏」，顶栏会出现 `源码 / 风格` 开关。
   切到**风格**后应该看到：
   - 编辑区**长得和右边预览一模一样** —— 同样的字号、分割线、表格、代码块底色、公式
   - 顶部多了一条工具栏（B / I / U / S / `<>`）
   - 选中一段文字按 `Ctrl+B` → 立刻变粗；再按一次 → 取消
   - `Ctrl+U` → 下划线；`Ctrl+E` → 行内代码
   - 改完之后切回**源码**，应该能看到对应的 Markdown 记号被写回去了
   - **换风格时编辑区外观会立刻跟着变**：选「Aider」行内代码变青色加粗黑底，
     选「Claude Code 终端」行内代码变 `#b1b9f9` 且无底色，选「ZCode」行内代码只换色不加底色
5. **阅读模式应该铺满整个窗口**：逐个风格切过去，面板底色应该一直铺到窗口两边，
   内容栏按各风格自己的宽度居中（Codex 736px / Claude 720px / ZCode 65ch …）。
6. **分栏拖动**：切到「分栏」，鼠标移到中间那条分隔条上（会变成左右箭头），按住左右拖。
   双击分隔条复位成 1:1。
7. **另存为**：点「另存为」，桌面端会弹系统保存对话框（可以改文件名和位置），
   保存后标题栏的文件名会跟着变。

> 如果还是黑屏崩溃，说明另有原因，请把 `事件查看器 → Windows 日志 → 应用程序` 里最新那条
> `Application Error`（异常代码 `0xe0434352` 那种）发我。
