export const SAMPLE = String.raw`# Markdown 阅读器 · 示例文档

这是一份演示文档，用来检查渲染管线的每个环节。直接把任意 \`.md\` 文件拖进窗口就能打开，\`Ctrl+S\` 保存。

## GFM 表格与任务列表

| 渲染环节 | 使用的库 | 状态 |
| --- | --- | --- |
| Markdown 解析 | react-markdown 9 | <span class="rich-badge">同款</span> |
| 表格 / 任务列表 | remark-gfm 4 | <span class="rich-badge">同款</span> |
| 数学公式 | remark-math + KaTeX | <span class="rich-badge">同款</span> |
| 代码高亮 | rehype-highlight + highlight.js 11 | <span class="rich-badge">同款</span> |
| 富 HTML + 消毒 | rehype-raw + rehype-sanitize | <span class="rich-badge">同款</span> |

- [x] GFM 表格
- [x] KaTeX 公式
- [ ] 你自己的待办事项

## 数学公式

质能方程 $E = mc^2$，行内公式和块级公式都支持：

$$\int_0^1 x^2 \, dx = \frac{1}{3}$$

## 代码高亮

` + '```' + String.raw`js
// highlight.js 会给 token 上色
export function fib(n) {
  return n <= 1 ? n : fib(n - 1) + fib(n - 2)
}
console.log([1, 2, 3, 4, 5].map(fib))
` + '```' + String.raw`

## 结构化卡片（AutoClaw 同款视觉积木）

<div class="rich-grid">
  <section class="rich-card">
    <div class="rich-card-title"><span class="rich-icon rich-icon-check"></span>离线可用</div>
    单文件构建，所有依赖已内联，断网也能双击打开。
  </section>
  <section class="rich-card">
    <div class="rich-card-title"><span class="rich-icon rich-icon-check"></span>所见即所得</div>
    左侧 CodeMirror 编辑，右侧实时渲染，滚动自动跟随。
  </section>
</div>

<div class="rich-timeline">
  <div class="rich-step"><span class="rich-step-marker">1</span>
    <div class="rich-step-body"><div class="rich-step-title">编辑</div>
    <div class="rich-step-text">CodeMirror 6 + Markdown 语法支持，代码块内嵌语言高亮</div></div>
  </div>
  <div class="rich-step"><span class="rich-step-marker">2</span>
    <div class="rich-step-body"><div class="rich-step-title">渲染</div>
    <div class="rich-step-text">remark 解析 → rehype 处理（KaTeX / highlight / raw HTML）→ React 渲染</div></div>
  </div>
  <div class="rich-step"><span class="rich-step-marker">3</span>
    <div class="rich-step-body"><div class="rich-step-title">消毒</div>
    <div class="rich-step-text">rehype-sanitize 白名单过滤，script 与事件属性一律剥除</div></div>
  </div>
</div>

> 提示：右上角可以切换 编辑 / 分栏 / 阅读 三种模式，以及亮色暗色主题。

## 渲染风格切换

右上角下拉可切换 16 种风格，按「桌面形态 / 终端形态」分组，每种对应一个真实智能体/产品的
真实渲染方式：

| 分组 | 风格 | 对应形态 | 关键差异点 |
| --- | --- | --- | --- |
| 桌面 | AutoCLAW | AutoCLAW | react-markdown + KaTeX + GitHub 版高亮 + rich-* 卡片 |
| 桌面 | Codex | Codex 桌面端（Electron） | 正文 13px、H1 22px/500、内容栏 736px、六级标题分色 |
| 桌面 | Claude | Claude 桌面端 / 网页端 | 底 #faf9f5 + 橙 #d97757，标题 Poppins、正文 Lora 衬线 |
| 桌面 | Qoder | Qoder IDE（VS Code 底座） | 继承 VS Code 主题，行为推荐卡片 |
| 桌面 | WorkBuddy | WorkBuddy 桌面工作台 | 正文 13px、标题 1.25/1.125/1em、表格圆角 16px |
| 桌面 | Antigravity | Google Antigravity IDE | Darcula 主题预设，frontmatter 元数据卡片 |
| 桌面 | ZCode | ZCode 桌面端 | Tailwind Typography 原版 .prose（H1 2.25em/800） |
| 桌面 | OpenCode | OpenCode 桌面端 | Radix 暖灰阶，底 #f8f8f8 / #101010 |
| 桌面 | VS Code | VS Code 内置预览 | markdown-it 排版，H1 / H2 下边框 |
| 终端 | 通用终端 | 通用 ANSI | 等宽 + One Dark，标题靠字形而非 # 号 |
| 终端 | Codex 终端 | Codex CLI（Ratatui） | 执行单元格带左侧色条 |
| 终端 | Claude Code 终端 | Claude Code CLI（chalk） | H1 粗斜下划线、行内代码主题紫 |
| 终端 | Grok 终端 | Grok Build CLI | Tokyo Night，左侧 ┃ 强调列按块类型换色 |
| 终端 | Gemini CLI | Gemini CLI | 默认 Atom One Dark（#282C34） |
| 终端 | Aider | Aider（Python Rich） | 表格用 Unicode 制表符画框，代码/引用用 Panel |
| 终端 | Copilot CLI | GitHub Copilot CLI | GitHub 暗色（配色为近似，官方未公开） |

切到终端形态时**整个窗口会一起变暗**（预览区、标题栏、状态栏、左侧编辑器），
公式会显示为原始 TeX 源码——这是真实行为，终端不做公式排版。
但代码块在终端形态里**都有语法高亮**，因为 Claude Code / Codex / Grok 的终端本来就有。
`
