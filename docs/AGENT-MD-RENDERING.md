# 主流智能体的 Markdown 渲染实况 vs 本应用现有风格

调研时间：2026-09-23  
本轮**只调研，未改动任何应用代码**。

---

## 一、先说结论

1. **你想要的「一个 agent 一种风格」现在没实现。** 现有 4 个风格是按**渲染技术栈/产品家族**切的  
   （AutoClaw / VS Code 系 / OpenCode / 终端），不是按 agent 切的。
2. **你列的 5 个 agent 里，3 个没有对应风格**：`buddy`（WorkBuddy）、`Claude`、`zcode` 都没有；  
   `codex` 和 `Claude` 被合并进同一个 `terminal`，`qoder` 被合并进 `vscode`（还跟 CodeBuddy、  
   Antigravity 混在一起）。
3. **`terminal` 这个风格名和实现都站不住。** 两个原因：
   - 它把 Claude Code 和 Codex **两个不同公司的产品**当成一种风格。两者终端实现完全不同  
     （Claude Code 是 `marked` + Ink/React + chalk；Codex 是 Rust + Ratatui + crossterm），  
     配色与主题系统各有一套。
   - 更根本的是：**终端不是这两个产品的主要形态**。Claude Code 有 5 个端、Codex 有 4 个端，  
     桌面端和网页端都是富文本渲染。拿最不像的那个端代表整个产品，方向就偏了。
4. **`terminal` 的具体样式多处与事实相反**（详见第五节），其中「标题加 `# ` 前缀」方向正好相反——  
   Claude Code 恰恰是**把 `#` 吃掉**、改用加粗/斜体/下划线表现标题。

---

## 二、各智能体的实际形态与渲染方式

### 2.1 Claude / Claude Code（Anthropic）

| 端                      | Markdown 渲染方式                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 终端 CLI                 | `marked` 的 lexer 解析 → 递归渲染为 **ANSI 字符串**（chalk）。**标题不保留 `#`**：H1 = 加粗+斜体+下划线，H2+ = 加粗；`strong` = 只加粗；`em` = 只斜体；行内代码用主题色（`permission` 键，蓝紫 `rgb(177,185,249)`）；代码块**有语法高亮**（React Suspense 懒加载，加载前回退纯文本）；引用块 = 暗灰 `│` + 斜体；表格 = 完整 ASCII 表格、按 CJK 字符宽度自动算列宽；链接 = OSC 8 可点击；`hr` = `---`。颜色走语义键 + 主题，可切 16 色 ANSI 或色盲友好主题 |
| VS Code / JetBrains 插件 | 富文本 HTML                                                                                                                                                                                                                                                                                                                 |
| 桌面 App                 | 富文本 HTML（有独立的桌面端应用）                                                                                                                                                                                                                                                                                                      |
| 网页 claude.ai           | 富文本 HTML，公式走 KaTeX，代码块带复制按钮                                                                                                                                                                                                                                                                                              |

来源：`book.cuiliang.ai/claude-code-deep-dive` 第 18 章（基于 Claude Code 源码的深度解析）。  
注意：该章**未明确**说明「加粗/斜体是否绑固定颜色」「代码块有无背景色/边框」，这几项只能确认是  
「字形样式 + 语义色解耦」。

### 2.2 Codex（OpenAI）

| 端            | Markdown 渲染方式                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 终端 CLI       | Rust + **Ratatui** + crossterm → ANSI。有专门模块 `markdown` / `markdown_render` / `markdown_stream`；能力含完整 Markdown 支持、多语言语法高亮、智能换行、URL 自动高亮、流式渲染；有 `terminal_palette` 调色板检测与 `theme_picker` 多主题；命令执行结果用独立的 Execution Cell 展示    |
| 桌面 App       | **Electron 应用**（`app://-/index.html`）。聊天消息是富 HTML（`_MarkdownRoot_*`），Markdown 文件用 CodeMirror 打开（`.cm-content[data-language="markdown"]`）。原生默认：正文 13px、H1 22px/500、**H1–H6 各有原生颜色**、内容栏宽 736px、**短回复居中**、引用块有蓝色左边框 + 第二条装饰线 |
| IDE 插件 / Web | 富文本 HTML                                                                                                                                                                                                                   |

来源：Codex CLI 部分来自 `book.cuiliang.ai/codex-deep-dive` 第 14 章；桌面端部分来自  
`github.com/laughmaker/codex-plugin` 的实测交接文档（通过 CDP 读真实 DOM 计算样式得到，可信度较高）。

### 2.3 Qoder（阿里）

- 形态：**IDE**（VS Code 底座）+ IDEA 插件 + 桌面版。
- 会话面板的 UI 元素**完全继承 VS Code 当前激活主题**（聊天窗口、侧边栏、按钮）。
- 有 Ask / Agent 双模式；Agent 模式跑完会在消息末尾追&#x52A0;**「行为推荐卡片」**（Review Code Changes /  
  Run Feature Test / AI Suggestion，点击可直接填充发送）。
- 支持把会话拆到**独立窗口**并行看多个 Agent 任务。
- 代码改动走 diff 视图。

来源：`docs.qoder.com/zh/user-guide/chat/overview` + 主题继承说明。

### 2.4 ZCode（智谱）

- 形态：**桌面端 Electron 应用**（有 Windows x64 / arm64 exe，v3.14.3）。
- 定位「氛围编程工具」，多智能体协作。
- 界面结构：侧边栏 + 对话区 + 右侧面板 + **终端面板**（可拖拽 resize）+ 命令面板 + 设置页。
- Markdown 呈现的显著特征：
  - 任务列表带**耗时**（`2m` / `9m` / `51m` / `1d`）
  - 命令以**行内 chip** 展示，如 `已运行` + 等宽命令片段
  - **文件变更卡片**：`3 个文件已更改 +734 -7`，可展开、带「撤销」按钮
  - `Goal` / `Progress` 状态指示

来源：`zcode.z.ai/cn` 官网实际页面内容。

### 2.5 WorkBuddy（你说的 "buddy"）

- 形态：腾讯的**桌面级 AI 智能体工作台**（桌面 GUI 应用）。
- 注意：**WorkBuddy 与 AutoClaw 是两个不同产品**。本应用现有默认风格标签写的是  
  「AutoClaw 内部智能体同款」，并不是 WorkBuddy。

来源：产品介绍类文章（腾讯云开发者社区、博客园等）。本次未拿到 WorkBuddy 渲染层面的  
像素级规格，只确认是桌面 GUI + 富文本。

---

## 三、本应用现有 4 种风格的实现（代码级）

`src/app.jsx` 第 22–26 行定义，`src/styles.css` 第 64–218 行实现。

| id         | 标签        | 描述文案                                                                  | 实现要点                                                                                                                          |
| ---------- | --------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `autoclaw` | AutoClaw  | react-markdown + KaTeX + highlight.js（AutoClaw 内部智能体同款）               | 无专属 CSS，用全局默认（`rich-*` 卡片积木、KaTeX、hljs）                                                                                       |
| `vscode`   | VS Code 系 | CodeBuddy / Qoder / Antigravity 走 VS Code 底座，markdown-it 风格 + VS 配色高亮 | 预览区限宽 980px 居中、H1/H2 有下边框、引用块无底色、代码块 6px 圆角、深色下写死 VS Code 高亮色（`#569cd6` / `#ce9178` / `#dcdcaa` 等）                            |
| `opencode` | OpenCode  | marked + Shiki + Mermaid                                              | 代码块 4px 圆角 + 左侧 3px 强调色竖条、表格 13px、卡片 6px 圆角、时间线竖线用强调色                                                                         |
| `terminal` | 终端 CLI    | Claude Code / Codex 风格：等宽字体 ANSI 配色，公式与代码高亮回退为纯文本                     | 等宽字体、标题**加 `# ` 前缀**、`strong` 染黄 `#f0c674`、`em` 染紫 `#b294bb`、链接蓝 `#81a2be`、代码块浅底、**代码高亮不加载**（`rehypeHighlight` 被跳过）、KaTeX 不加载 |

---

## 四、逐项对比

| 维度         | Claude Code（终端）  | Codex（终端） | Codex（桌面）              | Qoder               | ZCode       | 本应用 `terminal`       | 本应用 `vscode`          |
| ---------- | ---------------- | --------- | ---------------------- | ------------------- | ----------- | -------------------- | --------------------- |
| 标题保留 `#` 吗 | **否**（吃掉了）       | 未确认       | 否                      | 否                   | 否           | **保留，还主动加** ❌        | 否 ✅                   |
| 标题表现       | H1 粗+斜+下划线，H2+ 粗 | 主题色       | H1 22px/500，H1–H6 各有颜色 | VS Code 主题          | 富文本         | 全部 1em 粗体 + `#` 前缀 ❌ | 1.9em/1.55em 粗体 + 下边框 |
| 代码块语法高亮    | **有**            | **有**     | 有                      | 有                   | 有           | **没有**（回退纯文本）❌       | 有（VS 配色）✅             |
| 公式         | 不渲染（终端）          | 不渲染       | 富文本                    | 富文本                 | 富文本         | 不渲染 ✅                | KaTeX                 |
| 等宽字体       | 是                | 是         | 正文否 / 代码是              | 否                   | 否           | 全文是 ✅                | 正文否 ✅                 |
| 卡片类积木      | 无（终端）            | 无（终端）     | 有                      | **行为推荐卡片**          | **任务/变更卡片** | 无 ✅                  | 只有 `rich-*`           |
| 消息对齐       | —                | —         | 短回复居中                  | 左对齐                 | 左对齐         | —                    | —                     |
| 主题来源       | 语义色 + 多主题        | 多主题可选     | 明/暗                    | **继承 VS Code 主题** ✅ | 明/暗         | 固定色值 ❌               | 明/暗 + VS 配色 ✅         |

✅ = 与事实一致；❌ = 与事实不符。

---

## 五、`terminal` 风格的具体问题清单

1. **标题加 `# ` 前缀** —— 方向反了。Claude Code 用 `chalk.bold.italic.underline` 渲染 H1，  
   `#` 作为 Markdown 标记被 lexer 消费掉，不会显示。应用反而把 `#` 画出来，是「伪终端」而非还原。
2. **`strong` 染成黄色 `#f0c674`** —— Claude Code 的 `strong` 只是 `chalk.bold`，不绑颜色。  
   黄色是 Tomorrow 主题的配色，跟 Claude Code 无关。
3. **`em` 染成紫色 `#b294bb`** —— 同上，Claude Code 的 `em` 只是 `chalk.italic`。
4. **代码块回退为纯文本** —— 与事实相反。Claude Code 和 Codex 的终端**都有语法高亮**，  
   Claude Code 还专门用 Suspense 懒加载高亮引擎。回退纯文本反而是它俩都没有的行为。
5. **把两个产品合成一个风格** —— Claude Code 与 Codex 的终端实现、配色体系、主题系统完全不同，  
   合成一个「终端 CLI」无法体现任何一方的真实观感。
6. **公式回退为纯文本** —— 这一条**是对的**，终端确实不渲染 KaTeX，可以保留。

---

## 六、最终落地的 16 种风格（已实施）

下拉框按「桌面形态 / 终端形态」分两组，**一个 agent 一种风格**：

### 桌面形态（9）

| # | 风格 id | 标签 | 依据来源 |
| --- | --- | --- | --- |
| 1 | `autoclaw` | AutoCLAW | 原有视觉，保留未动 |
| 2 | `codex` | Codex | Codex 桌面端实测 DOM |
| 3 | `claude` | Claude | Anthropic 官方品牌规范 |
| 4 | `qoder` | Qoder | 本机 D:/Qoder + VS Code Light+/Dark+ 变量 |
| 5 | `workbuddy` | WorkBuddy | 本机 D:/WorkBuddy 的 app.asar（`.cb-markdown`） |
| 6 | `antigravity` | Antigravity | Antigravity 2.11.0 更新日志 |
| 7 | `zcode` | ZCode | 本机 D:/ZCode 的 app.asar（Tailwind Typography `.prose`） |
| 8 | `opencode` | OpenCode | 本机 @opencode-aidesktop 的 app.asar（Radix 色板） |
| 9 | `vscode` | VS Code | VS Code 内置预览（markdown-it） |

### 终端形态（7）

| # | 风格 id | 标签 | 依据来源 |
| --- | --- | --- | --- |
| 10 | `terminal` | 通用终端 | 通用 ANSI 终端（One Dark） |
| 11 | `codex-terminal` | Codex 终端 | Codex CLI TUI（Ratatui） |
| 12 | `claude-terminal` | Claude Code 终端 | Claude Code 终端逐 token 映射表 |
| 13 | `grok-terminal` | Grok 终端 | Grok Build CLI 的 `xai-grok-pager` 源码解析 |
| 14 | `gemini-terminal` | Gemini CLI | Gemini CLI 官方主题文档 |
| 15 | `aider-terminal` | Aider | Rich 官方 Markdown 渲染文档 |
| 16 | `copilot-terminal` | Copilot CLI | GitHub 官方文档（配色近似） |

---

## 六之二、从本机安装的应用里实测到的参数

**这一节的数据不是查资料来的，是直接从本机已安装的 Electron 应用里解出 `app.asar`、
抽出真实 CSS 抄下来的。** 解包脚本：`buddy/_refs/extract-asar.mjs`（自写的 asar 解析器，
只读不修改原应用）；抽出的 CSS 在 `buddy/_refs/<应用名>/`。

### WorkBuddy —— `D:/WorkBuddy/resources/app.asar`

样式文件 `renderer/assets/lib-chat-ui-*.css`，选择器前缀 `.cb-markdown`（cb = CodeBuddy）。

```
--cb-md-font-size: 13px
--cb-md-heading-font-size: var(--cb-md-h1-font-size)
--cb-md-h1-font-size: 1.25em   （紧凑档另有 0.875em）
--cb-md-h2-font-size: 1.125em  （紧凑档另有 0.875em）
--cb-md-h3-font-size: 1em      （紧凑档另有 0.875em）
--cb-md-h4-font-size: 0.875em
--cb-md-font-weight-heading: 600
--markdown-line-gap: 4px
--markdown-content-gap: 12px
--markdown-list-padding-left: 2em
```

- 表格：`border: 1px solid …; border-collapse: separate; border-spacing: 0; border-radius: 16px; overflow: hidden;`
- 行内代码：`padding-inline: 4px; border-radius: 3px; background: rgba(255,255,255,.1)`
- 代码块：`background: var(--cb-vscode-sideBar-background)`（**没有圆角**）
- **引用块：`all: unset`** —— 完全重置，不带边框、底色、缩进
- 配色走 VS Code 主题变量，默认值：Light `#ffffff / #4c4f69 / #f3f3f3 / #006ab1`，
  Dark `#1e1e1e / #cccccc / #252526 / #3794ff`

> 结论：WorkBuddy 的正文与**标题几乎是同一个字号**（1.25/1.125/1em 递减），排版非常紧凑，
> 靠字重和留白区分层级，而不是靠字号跳变。这一点和网页阅读器的习惯差得很远。

### ZCode —— `D:/ZCode/resources/app.asar`

样式文件 `out/renderer/assets/styles-*.css`。ZCode 用 **Tailwind CSS + Tailwind Typography**，
markdown 直接套原版 `.prose`：

```
.prose { color: var(--tw-prose-body); max-width: 65ch; font-size: 1rem; line-height: 1.75 }
.prose-sm { font-size: .875rem; line-height: 1.71429 }

.prose :where(h1) { font-size: 2.25em; font-weight: 800; line-height: 1.11111; margin: 0 0 .888889em }
.prose :where(h2) { font-size: 1.5em;  font-weight: 700; line-height: 1.33333; margin: 2em 0 1em }
.prose :where(p)  { margin: 1.25em 0 }
.prose :where(a)  { color: var(--tw-prose-links); font-weight: 500; text-decoration: underline }
.prose :where(strong) { color: var(--tw-prose-bold); font-weight: 600 }
.prose :where(code)   { color: var(--tw-prose-code); font-size: .875em; font-weight: 600 }
.prose :where(pre)    { color: var(--tw-prose-pre-code); background: var(--tw-prose-pre-bg); border-radius: .375rem }
.prose :where(blockquote) { border-inline-start-width: .25rem; color: var(--tw-prose-quotes); font-style: italic }
.prose :where(hr) { border-top-width: 1px; margin: 3em 0 }
```

配色是 Tailwind 的**默认灰阶**（从它 CSS 里原样抄的 oklch 值）：

```
--tw-prose-body:        oklch(37.3% .034 259.733)   /* gray-700 */
--tw-prose-headings:    oklch(21%   .034 264.665)   /* gray-900 */
--tw-prose-pre-bg:      oklch(27.8% .033 256.848)   /* gray-800 */
--tw-prose-invert-body: oklch(87.2% .01  258.338)   /* gray-300 */
--tw-prose-invert-headings: #fff
--tw-prose-invert-pre-bg:   #00000080
```

应用底色：`--color-background: #f8f8f8`（浅）/ `#161616`（深）。

> 结论：ZCode 是**唯一一个能精确复刻**的 —— 直接用 Tailwind Typography 的原版规则即可，
> 无需猜任何数值。

### OpenCode —— 桌面版安装目录下的 `app.asar`

样式文件 `out/renderer/assets/main-*.css`。用 **Radix Colors** 的 12 阶色板 + Tailwind：

```
--background-base:  #f8f8f8 / #101010
--background-weak:  #f3f3f3 / #1e1e1e
--background-strong:#fcfcfc / #121212
--text-base:        #6f6f6f / #ffffff9e     （深色是白 62%）
--border-base:      #00000029 / #ffffff32
--text-interactive-base: #034cff / #9dbefe
--blue-9:           #0091ff
--text-diff-add-base:    #167517 / #c4ffc0   --text-diff-add-strong:    #1d3e1c / #4a7348
--text-diff-delete-base: #fa3012 / #ec2f14   --text-diff-delete-strong: #601a0f / #ffe0da
--gray-dark-1/2/3:   #131010 / #1b1818 / #252121   （灰阶偏暖）
--gray-light-1/2/3:  #fdfcfc / #f9f8f8 / #f1f0f0
```

> 结论：OpenCode 的灰阶**明显偏暖**（`#131010` 不是中性黑），强调色是蓝 `#034cff`。
> 之前用的青绿是错的。

### Qoder —— `D:/Qoder/resources`

是 **VS Code 底座**（`resources/extensions/` 下是 `qoder.*` 内置扩展，有 `product.json`、
`bundled-resources`）。会话面板继承 VS Code 主题，所以直接用 VS Code 的真实变量：

```
Light+: editor.background #ffffff  sideBar.background #f3f3f3
        editor.foreground #000000  panel.border #e7e7e7  textLink.foreground #006ab1
Dark+:  editor.background #1e1e1e  sideBar.background #252526
        editor.foreground #d4d4d4  panel.border #3c3c3c  textLink.foreground #3794ff
```

### AutoCLAW —— `D:/AutoClaw/resources/app.asar`

有专门的 `out/renderer/assets/MarkdownRenderer-*.css`。代码高亮用的是 **highlight.js 的
GitHub 主题**（浅色 `#24292e / #d73a49 / #6f42c1 / #005cc5 / #032f62 / #e36209 / #6a737d / #22863a`；
深色 `#f5f7ff / #ff7b72 / #a5d6ff / #79c0ff / #d2a8ff`）。现有 AutoCLAW 风格用的就是这个配色。

---

### 实施时修正的三处事实错误

1. 删掉标题的 `# ` 前缀（Claude Code 是把 `#` 消费掉的）。
2. 终端形态恢复代码语法高亮（Claude Code 与 Codex 的终端都有高亮）。
3. `strong` / `em` 不再绑死颜色（Claude Code 只加粗 / 只斜体，不绑色）。

---

## 六之三、从源码 / 原生二进制里实测到的终端参数

上一轮这四种终端形态还是查资料拼的。这一轮直接下源码与二进制拆解，**全部换成精确值**。

下载物统一放在 `buddy/_refs/downloads/`（约 1.4 GB，分析完可整目录删掉）。
GitHub 在本机不通（`raw.githubusercontent.com` 返回 000），全部走镜像：
npm → `registry.npmmirror.com`，PyPI → `pypi.org`，源码 → `gitcode.com`。

### Grok —— Grok Build 源码（gitcode 镜像，Rust，4125 个文件）

关键文件：`crates/codegen/xai-grok-pager-render/src/theme/tokyonight.rs`（`Theme::tokyonight()`）
与同目录的 `md_style.rs`；代码高亮主题 `xai-grok-markdown/assets/tokyo-night.tmTheme`。

```rust
pub const BG_STORM: Color = rgb(36, 40, 59);      // #24283b ← 默认主题是 Storm，不是 Night
pub const BG_HIGHLIGHT: Color = rgb(41, 46, 66);  // #292e42
pub const FG: Color = rgb(192, 202, 245);         // #c0caf5
pub const COMMENT: Color = rgb(86, 95, 137);      // #565f89
pub const BLUE: Color = rgb(122, 162, 247);       // #7aa2f7
pub const MAGENTA: Color = rgb(187, 154, 247);    // #bb9af7
pub const GREEN1: Color = rgb(115, 218, 202);     // #73daca
pub const TEAL: Color = rgb(26, 188, 156);        // #1abc9c
pub const ORANGE: Color = rgb(255, 158, 100);     // #ff9e64
pub const RED: Color = rgb(247, 118, 142);        // #f7768e
pub const GREEN: Color = rgb(158, 206, 106);      // #9ece6a
pub const YELLOW: Color = rgb(224, 175, 104);     // #e0af68
```

markdown 元素映射（源码里就是这些字段名）：

| 元素 | 字段 | 值 |
| --- | --- | --- |
| H1 | `md_heading_h1` + BOLD | TEAL `#1abc9c` |
| H2 | `md_heading_h2` + BOLD | BLUE `#7aa2f7` |
| H3 | `md_heading_h3` + BOLD | ORANGE `#ff9e64` |
| H4 | `md_heading_h4` + BOLD | RED `#f7768e` |
| H5 | `md_heading_h5` + BOLD | GREEN `#9ece6a` |
| H6 | `md_heading_h6` + BOLD | MAGENTA `#bb9af7` |
| 行内代码 | `md_code` | GREEN1 `#73daca` |
| 代码块底色 | `md_code_bg` | `#292e42` |
| 引用块 / 列表 / 分隔线 | `md_muted` | COMMENT `#565f89` |
| 链接 | `link_fg` | BLUE `#7aa2f7` + UNDERLINED |
| 正文 | `md_text` | FG `#c0caf5` |

强调列：源码注释里明确写了用的是 **`┃`（U+2503 heavy vertical）**，按块类型换色 ——
用户 `accent_user` BLUE、助手 `accent_assistant` MAGENTA、思考 `accent_thinking` `#3b4261`、
工具 `accent_tool` `#737aa2`。

### Gemini CLI —— 官方 npm 包 @google/gemini-cli@0.60.0

`bundle/chunk-CMLALLX3.js` 里有 `var atomOneDarkColors = {...}` 与
`var AtomOneDark = new Theme(name, type, hljsStyles, colors)`。

```
Background #282c34   Foreground #abb2bf
LightBlue/AccentBlue #61aeee   AccentPurple #c678dd   AccentCyan #56b6c2
AccentGreen #98c379   AccentYellow #e6c07b   AccentRed #e06c75
DiffAdded #39544E   DiffRemoved #562B2F   Comment/Gray #5c6370
GradientColors ["#61aeee", "#98c379"]
```

> 注意 `AccentYellow` 是 **#e6c07b**（不是网上常见的 e5c07b）。

hljs 映射 32 条逐条对照（`hljs-keyword`→AccentPurple、`hljs-string`→AccentGreen、
`hljs-attr/number/type`→AccentYellow、`hljs-title/symbol/link/meta`→AccentBlue、
`hljs-section/name/deletion/subst`→AccentRed、`hljs-literal`→AccentCyan、
`hljs-comment/quote`→Comment + italic）。

内置主题共 **19 套**：AyuDark/Light、AtomOneDark、Dracula、DefaultLight/Dark、GitHubDark/Light、
GitHubDark/LightColorblind、GoogleCode、Holiday、ShadesOfPurple、SolarizedDark/Light、XCode、
TokyoNight、ANSI、ANSILight。

### Claude Code —— 原生二进制（108 MB，Bun 打包，JS 源码是明文）

包结构：npm 的 `@anthropic-ai/claude-code` 只是个壳，真实二进制在平台包
`@anthropic-ai/claude-code-win32-x64`（226 MB）里。二进制里能直接读到
`var v = {autoAccept:"rgb(135,0,255)", ...}` 这样的主题对象，共 **72 个语义键 × 4 套主题**
（dark / light / dark-daltonized / light-daltonized），已导出到
`buddy/_refs/downloads/claude-bin/package/claude-code-themes.json`。

深色主题关键值：

```
claude          #d77757   ← Anthropic 品牌橙，和官网品牌规范里的 #d97757 一致
permission      #b1b9f9   ← 行内代码用的就是这个
text            #ffffff
inverseText     #000000
inactive        #999999   subtle #505050
success         #4eba65   error #ff6b80   warning #ffc107
autoAccept      #af87ff   bashBorder #fd5db1   planMode #48968c   ide #4782c8
diffAdded 底     #225c2b   diffRemoved 底 #7a2936
diffAddedWord   #38a660   diffRemovedWord #b3596b
subagent: red #dc2626 / blue #6a9bcc / green #16a34a / yellow #ca8a04 /
          purple #827dbd / orange #d97757 / pink #c46686 / cyan #0891b2
rainbow:  red #eb5f57 / orange #f58b57 / yellow #fac35f / green #91c882 /
          blue #82aadc / indigo #9b82c8 / violet #c882b4
```

还发现了 `red_FOR_SUBAGENTS_ONLY` 这类键名、`rainbow_*_shimmer` 一整套渐变色，
以及颜色格式校验器（`rgb()` / `#rrggbb` / `#rgb` / `ansi256(n)`）与
`bgHex` / `bgAnsi256` / `bgRgb` 三种背景表示。

### Aider —— Aider 0.86.2 源码 + Rich 15.0.0 源码

Aider 侧（`aider/io.py`、`aider/mdstream.py`）：

```python
assistant_output_color="blue"   # 助手整段输出套 blue
code_theme="default"            # Pygments 的 "default" 主题
tool_warning_color="#FFA500"

class NoInsetMarkdown(Markdown):
    elements = {**Markdown.elements,
        "fence": NoInsetCodeBlock, "code_block": NoInsetCodeBlock,
        "heading_open": LeftHeading}

class LeftHeading(Heading):          # H1 画成 box.HEAVY 的重边框 Panel
    yield Panel(text, box=box.HEAVY, style="markdown.h1.border")

class NoInsetCodeBlock(CodeBlock):   # 代码块 padding=(1,0)：上下留白、左右不留
    Syntax(code, lexer, theme=self.theme, word_wrap=True, padding=(1, 0))
```

Rich 侧（`rich/default_styles.py`）的 markdown 默认样式全表：

```
markdown.em            italic
markdown.strong        bold
markdown.code          bold, cyan, bg black      ← 行内代码
markdown.code_block    cyan, bg black
markdown.block_quote   magenta
markdown.list          cyan
markdown.item.bullet   bold
markdown.item.number   cyan
markdown.hr            dim
markdown.h1            bold + underline          ← 外面再包 box.HEAVY 边框
markdown.h2            magenta + underline
markdown.h3            magenta + bold
markdown.h4            magenta + italic
markdown.h5            italic
markdown.h6            dim
markdown.link          bright_blue
markdown.table.border  cyan
markdown.table.header  cyan
markdown.kbd           bold + bright_yellow
```

> 注意 Rich 用的是 **ANSI 具名色**（blue / cyan / magenta / dim），实际观感取决于终端调色板；
> 实现里取的是 Windows Terminal 默认的 Campbell 调色板。

### GitHub Copilot CLI —— 仍是近似

`@github/copilot@1.0.88` 也是壳，真实二进制在 `@github/copilot-win32-x64`（144 MB tgz /
151 MB exe）。但**从二进制里只提取到 6 个 hex 色值**
（`#000000` / `#20488D` / `#616567` / `#DDDDDD` / `#feedba` / `#ffffff`），
说明它的配色大部分走 **ANSI 具名色**而不是固定 RGB；官方也没有公开完整调色板。
所以这一条是目前 16 个风格里唯一仍属近似的，实现里取 GitHub 自家暗色配色，
并在代码注释中明确标注。

---

### 精度说明

- **结构参数**（字号、内容栏宽度、圆角、对齐、标题处理方式）全部来自实测或官方规范。
- 桌面形态里 WorkBuddy / ZCode / OpenCode / Qoder / AutoCLAW 五种的结构与配色都是
  从本机安装的 `app.asar` 里**直接抄的实测值**，不是估算。
- **16 个风格里，15 个现在是精确值**（实测 / 官方规范 / 源码）：
  - 桌面 5 个（WorkBuddy / ZCode / OpenCode / Qoder / AutoCLAW）→ 本机安装的 `app.asar` 实测
  - 终端 4 个（Grok / Gemini CLI / Claude Code / Aider）→ 源码或原生二进制实测
  - 其余（Codex / Claude / Antigravity / VS Code / 通用终端 / Codex 终端）→ 官方规范或实测 DOM
- **仍属近似的只有两处**：
  - `copilot-terminal`：官方未公开调色板，二进制里只有 6 个 hex（其余走 ANSI 具名色），
    取 GitHub 暗色配色。
  - `codex-terminal` 的高亮调色板：Codex CLI 的主题用 **ANSI 256 色索引**定义
    （二进制里能读到 `#5FD7FF`=81、`#87AFD7`=110 这类 256 色近似值），
    没有 RGB 真值可抄，只能按索引近似。
- `codex` 桌面端的**六级标题具体色值**官方未公开，按实测到的「H1–H6 各有颜色」这一
  **结构事实**配色，色值本身是近似。

### 与第五节的对照

第五节的逐项对比表记录的是**改造前** 4 种风格与事实的偏差，留作对照，不再代表当前实现。

---

## 七、其他智能体的 md 渲染（已全部落地为风格）

这四个已经按下面的调研结果做成了风格（见第六节终端形态 13–16 项）。
本节保留原始调研记录，作为后续校对的依据。

### 小结：落地情况

| 候选 | 落地状态 | 说明 |
| --- | --- | --- |
| **Grok** | ✅ 已落地 `grok-terminal` | 与其余终端**差异最大**：左侧 `┃` 强调列 + Tokyo Night，一眼能分辨 |
| **Gemini CLI** | ✅ 已落地 `gemini-terminal` | 取默认 Atom One Dark，与现有几种都不撞色 |
| **Aider** | ✅ 已落地 `aider-terminal` | 制表符画框的表格是独一份；配色为近似 |
| **Copilot CLI** | ✅ 已落地 `copilot-terminal` | 官方未公开调色板，配色为近似 |

> 下拉已从 12 项扩到 16 项，并按要求改成了「桌面形态 / 终端形态」两组。
> 再加风格建议先补调研精度（Copilot CLI / Aider 的配色），而不是继续堆数量。

### 7.1 Grok（xAI）—— 差异最大，建议优先加

Grok Build CLI 是终端原生 TUI（Rust），有专门的 `xai-grok-markdown` / `xai-grok-pager` 渲染引擎。
它的特征和 Claude Code / Codex 都明显不同：

| 特征 | 具体做法 |
| --- | --- |
| **配色** | **Tokyo Night**。用户提示的强调色 `#7aa2f7`（蓝），思考块 `#bb9af7`（紫） |
| **左侧强调列** | 每条消息最左一列是一条竖条 `┃`，**按块类型换色**（用户 / 工具 / 思考 / 成功 / 失败各一色） |
| **代码高亮** | 围栏代码块走 **syntect**，配 Tokyo Night 主题，块底色 `bg_dark` |
| **行内代码** | 有**独立的背景色**（`bg_code` + `fg_code`），不是只换字色 |
| **思考块** | 默认**截断**为 3 行 + `⋯ N more lines`，可展开 |
| **工具调用块** | 默认**折叠成 1 行**（路径 + 数量摘要），可展开 |
| **运行中的块** | 逐行逐帧算亮度做**波浪动画** 🌊（`wave_brightness` + `blend_color`） |
| **换行** | Unicode 宽度感知（CJK / emoji 占 2 列），续行打 `↳` joiner 标记以保证复制保真 |

来源：`blog.gitcode.com` 的 xai-grok-pager 渲染管线深度剖析（基于开源仓库源码，含函数与常量）。

### 7.2 Gemini CLI（Google）—— 主题最多

- **12 套内置主题**，可用 `/theme` 切换：
  - 深色：`ANSI`、`Atom One`、`Ayu`、`默认`、`Dracula`、`GitHub`
  - 浅色：`ANSI Light`、`Ayu Light`、`Default Light`、`GitHub Light`、`Google Code`、`Xcode`
- 默认那套接近 **Atom One Dark**（`#282C34` 底 / `#ABB2BF` 前景 / `#61AFEF` 蓝 / `#98C379` 绿 / `#E06C75` 红 / `#C678DD` 紫 / `#E5C07B` 黄 / `#56B6C2` 青 / `#5C6370` 注释）。
- 另有 **Google Code** 浅色主题（Google 品牌配色）。
- 颜色按**语义角色**命名，用户可在 `settings.json` 里自定义：
  `Background` / `Foreground` / `LightBlue` / `AccentBlue` / `AccentPurple` / `AccentCyan` /
  `AccentGreen` / `AccentYellow` / `AccentRed` / `Comment` / `Gray` / `DiffAdded` / `DiffRemoved` /
  `GradientColors`。

来源：Gemini CLI 官方主题文档。

### 7.3 Aider —— 走 Python 的 Rich 库

- 用 **Rich**（Python 终端富文本库）渲染 Markdown。
- 最显眼的差异：**表格用 Unicode 制表符画框**（`┌─┬─┐` / `├─┼─┤` / `└─┴─┘`），
  代码块与引用块用 **Panel**（带边框的面板）包起来。
- 这和 Claude Code 的「空格对齐 ASCII 表格」是两种完全不同的终端表格画法。

来源：Rich 官方 Markdown 渲染文档与 API 参考。

### 7.4 GitHub Copilot CLI

- 终端原生，新界面 GA 版加了**标签页**浏览 Issues / PR。
- 会话内可配置 MCP / Skills / Plugins。
- 官方提到**强化了主题自定义与可访问性**（具体调色板未公开）。

来源：GitHub 官方文档 + 新版介绍。

---

## 八、资料来源与可信度

| 来源                                              | 覆盖内容             | 可信度                              |
| ----------------------------------------------- | ---------------- | -------------------------------- |
| `book.cuiliang.ai/claude-code-deep-dive` 第 18 章 | Claude Code 终端渲染 | 高（基于源码逐函数解析，含行号）                 |
| `book.cuiliang.ai/codex-deep-dive` 第 14 章       | Codex CLI TUI 架构 | 中高（架构级，未到标题符号层面）                 |
| `github.com/laughmaker/codex-plugin` 交接文档       | Codex 桌面端真实 DOM  | 高（CDP 读真实计算样式，含截图证据）             |
| `docs.qoder.com` 会话面板文档                         | Qoder 会话面板       | 高（官方文档）                          |
| `zcode.z.ai/cn` 官网                              | ZCode 界面与卡片      | 高（官方页面实读）                        |
| 腾讯云社区 / 博客园产品介绍                                 | WorkBuddy 形态     | 中（第三方文章，未到渲染层）                   |
| `blog.gitcode.com` Claude Code Desktop 复刻 PRD   | Claude 桌面端布局     | 低（**第三方复刻项目**，非官方规格，仅作参考，未采信为结论） |
| `blog.gitcode.com` xai-grok-pager 渲染管线剖析 | Grok 终端渲染 | 高（基于开源仓库源码，含函数名与常量值） |
| Gemini CLI 官方主题文档 | Gemini CLI 主题体系 | 高（官方文档，含色值与颜色键） |
| Rich 官方 Markdown 渲染文档 | Aider 的终端渲染 | 高（官方文档） |
| GitHub Copilot CLI 官方文档 / 新版介绍 | Copilot CLI 形态 | 中（确认形态与主题可定制，调色板未公开） |
