import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { schema } from './schema'
import { SAMPLE } from './sample'
import { renderToStaticMarkup } from 'react-dom/server'
import { htmlToMarkdown } from './rich'
import { log } from './log'
import { Toaster, toast } from 'sonner'
import {
  Sun, Moon, FolderOpen, Save, SaveAll,
  Bold, Italic, Underline, Strikethrough, Code as CodeIcon,
  ScrollText, X, Trash2, ChevronDown, Check, Info, Plus, ListTree
} from 'lucide-react'
import * as Select from '@radix-ui/react-select'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'

const MODES = [
  { id: 'edit', label: '编辑' },
  { id: 'split', label: '分栏' },
  { id: 'read', label: '阅读' }
]

// 编辑器两种模式：
//   source —— 纯源码编辑，Markdown 记号照原样显示
//   style  —— 按当前风格呈现行内格式（加粗 / 斜体 / 下划线 / 行内代码 / 链接 / 标题），
//             每一条都对应各 agent 源码里的真实规则，见 docs/AGENT-MD-RENDERING.md
const EDITOR_MODES = [
  { id: 'source', label: '源码' },
  { id: 'style', label: '风格' }
]

/** 用与预览完全相同的渲染管线，把 Markdown 渲染成 HTML 字符串。 */
function renderHtml(md, style) {
  const remarkPlugins = [remarkGfm]
  const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema]]
  if (!TERMINAL_STYLES.has(style)) {
    remarkPlugins.push(remarkMath)
    rehypePlugins.push(rehypeKatex)
  }
  rehypePlugins.push([rehypeHighlight, { detect: true, ignoreMissing: true }])
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
      {md}
    </ReactMarkdown>
  )
}

// ---------------------------------------------------------------------------
// 「风格」模式 = 完全按渲染结果编辑。
//   编辑区就是一个 contentEditable，里面装的正是上面那条管线产出的 HTML，
//   并且**直接复用预览的 class（preview）**，所以字号、分割线、表格、代码块、
//   公式 …… 与右侧预览完全一致 —— 这就是「渲染后是什么样，就什么样编辑」。
//   加粗 / 斜体 / 下划线用浏览器原生富文本命令，改动经 htmlToMarkdown() 写回
//   Markdown 源码；公式靠 KaTeX 的 <annotation> 无损往返。
// ---------------------------------------------------------------------------

/** 富文本编辑区。
 *  结构刻意与阅读模式对齐：面板拿 `preview` class，内容层用 `preview-body`，
 *  这样字号、行高、分割线、表格、内容栏宽度全部走同一套 CSS，不需要任何「模仿」。 */
function RichEditor({ html, onChange, onKeyDown }) {
  const ref = useRef(null)
  const applied = useRef(null)
  useEffect(() => {
    // 只有「外部」换了内容才重设 innerHTML —— 自己敲字时不能重设，否则光标会跳
    if (ref.current && applied.current !== html) {
      ref.current.innerHTML = html
      applied.current = html
    }
  }, [html])
  return (
    <div
      ref={ref}
      className="preview-body rich-editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={() => { if (ref.current) onChange(htmlToMarkdown(ref.current)) }}
      onKeyDown={onKeyDown}
    />
  )
}

// 悬停提示统一走 Radix Tooltip —— 原生 title 属性是操作系统画的，
// 配色和字体都跟应用对不上。portal 同样要进 .app 才能继承风格变量。
let tipHost = null
function Tip({ label, children, side = 'bottom' }) {
  if (!label) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={tipHost ?? undefined}>
        <Tooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={8}>
          {label}
          <Tooltip.Arrow className="tip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

const escapeHtml = (s) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

/** 浏览器里没有文件系统 API 时的兜底：走一次下载。 */
function downloadText(text, name) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  // 必须挂进文档再点：游离的 <a> 在部分浏览器里不会触发下载
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 加粗 / 斜体 / 下划线 / 删除线走浏览器原生命令（Chromium 与 WebView2 都支持）
const richCmd = (name) => document.execCommand(name)

// 行内代码没有原生命令，用 insertHTML 包一层
function richInlineCode() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  document.execCommand('insertHTML', false, '<code>' + escapeHtml(sel.toString()) + '</code>')
}

const FORMAT_BUTTONS = [
  { id: 'bold', Icon: Bold, title: '加粗（Ctrl+B）', run: () => richCmd('bold') },
  { id: 'italic', Icon: Italic, title: '斜体（Ctrl+I）', run: () => richCmd('italic') },
  { id: 'underline', Icon: Underline, title: '下划线（Ctrl+U）', run: () => richCmd('underline') },
  { id: 'strike', Icon: Strikethrough, title: '删除线', run: () => richCmd('strikeThrough') },
  { id: 'code', Icon: CodeIcon, title: '行内代码（Ctrl+E）', run: () => richInlineCode() }
]

// 16 种风格，分「桌面形态 / 终端形态」两组。
// 参数全部来自实测：桌面形态的四种（WorkBuddy / ZCode / Qoder / OpenCode）直接读的是
// 本机安装的 app.asar 里的真实 CSS；终端形态来自各家 TUI 的源码级解析。
// 依据与来源见 docs/AGENT-MD-RENDERING.md。
const STYLE_GROUPS = [
  {
    label: '桌面形态',
    items: [
      { id: 'autoclaw', label: 'AutoCLAW', desc: 'AutoCLAW：react-markdown + KaTeX + highlight.js，GitHub 版代码高亮，rich-* 卡片积木' },
      { id: 'codex', label: 'Codex', desc: 'Codex 桌面端（Electron）：正文 13px / H1 22px、内容栏 736px、六级标题分色、短回复居中' },
      { id: 'claude', label: 'Claude', desc: 'Claude 桌面端 / 网页端：官方品牌色 底 #faf9f5 / 字 #141413 / 橙 #d97757，标题 Poppins、正文 Lora 衬线' },
      { id: 'qoder', label: 'Qoder', desc: 'Qoder IDE（VS Code 底座）：会话面板继承 VS Code 主题，行为推荐卡片、diff 视图' },
      { id: 'workbuddy', label: 'WorkBuddy', desc: 'WorkBuddy 桌面工作台：正文 13px、标题 1.25/1.125/1em 紧凑递减、表格圆角 16px、VS Code 主题变量' },
      { id: 'antigravity', label: 'Antigravity', desc: 'Google Antigravity IDE：Darcula 主题预设，frontmatter 元数据卡片，内联 HTML 工件' },
      { id: 'zcode', label: 'ZCode', desc: 'ZCode 桌面端：Tailwind Typography 默认 .prose（H1 2.25em/800、H2 1.5em/700）、内容栏 65ch' },
      { id: 'opencode', label: 'OpenCode', desc: 'OpenCode 桌面端：Radix 暖灰阶，底 #f8f8f8 / #101010，强调 #034cff / #9dbefe，diff 三色' },
      { id: 'vscode', label: 'VS Code', desc: 'VS Code 内置 Markdown 预览：markdown-it 排版，H1 / H2 下边框，Dark+ 配色高亮' }
    ]
  },
  {
    label: '终端形态',
    items: [
      { id: 'terminal', label: '通用终端', desc: '通用 ANSI 终端：等宽 + One Dark 调色板，标题靠字形而非 # 号' },
      { id: 'codex-terminal', label: 'Codex 终端', desc: 'Codex CLI（Rust + Ratatui）：ANSI 渲染，执行单元格带左侧色条' },
      { id: 'claude-terminal', label: 'Claude Code 终端', desc: 'Claude Code CLI（marked + chalk）：H1 粗斜下划线、行内代码主题紫、引用块暗灰竖线' },
      { id: 'grok-terminal', label: 'Grok 终端', desc: 'Grok Build CLI（源码实测）：Tokyo Night **Storm** 底色 #24283b，六级标题各有颜色（TEAL/BLUE/ORANGE/RED/GREEN/MAGENTA），左侧 ┃ 强调列按块类型换色' },
      { id: 'gemini-terminal', label: 'Gemini CLI', desc: 'Gemini CLI 官方包实测：默认 Atom One Dark（#282c34），32 条 hljs 映射逐条对照，19 套内置主题' },
      { id: 'aider-terminal', label: 'Aider', desc: 'Aider + Rich 源码实测：H1 包在 box.HEAVY 重边框 Panel 里、H2 magenta 下划线、行内代码加粗青色黑底、引用块 magenta' },
      { id: 'copilot-terminal', label: 'Copilot CLI', desc: 'GitHub Copilot CLI：二进制里只有 6 个 hex，配色大部分走 ANSI 具名色；官方未公开完整调色板，取 GitHub 暗色近似' }
    ]
  }
]

const STYLES = STYLE_GROUPS.flatMap((g) => g.items)

// 终端形态：整个窗口强制暗色（含左侧编辑器），并且不渲染 KaTeX（真实终端没有公式排版）。
// 代码高亮所有风格都开 —— Claude Code / Codex / Grok 的终端都带语法高亮。
const TERMINAL_STYLES = new Set(STYLE_GROUPS[1].items.map((s) => s.id))

export default function App() {
  // ---- 多文档：docs 是唯一数据源；下面把「当前文档」的字段派生出来。
  //      这样所有**读取点**（text / fileName / fsPath / dirty）都不用改，
  //      只有**写入点**改走 patchActive()。 ----
  const [docs, setDocs] = useState(() => [
    { id: 'd1', name: '示例文档.md', text: SAMPLE, fsPath: null, dirty: false, sample: true }
  ])
  const [activeId, setActiveId] = useState('d1')
  const docSeq = useRef(1)
  const docsRef = useRef(docs)
  docsRef.current = docs
  const activeDoc = docs.find((d) => d.id === activeId) || docs[0]
  const text = activeDoc ? activeDoc.text : ''
  const fileName = activeDoc ? activeDoc.name : 'untitled.md'
  const fsPath = activeDoc ? activeDoc.fsPath : null
  const dirty = activeDoc ? activeDoc.dirty : false

  /** 只改「当前文档」的字段。 */
  const patchActive = useCallback((patch) => {
    setDocs((ds) => ds.map((d) => (d.id === activeId ? { ...d, ...patch } : d)))
  }, [activeId])

  /** 新增一个文档并切过去。 */
  const addDoc = useCallback(({ name, text: body, fsPath: path = null }) => {
    // 同一个文件不重复开：已经有同路径的文档就切过去
    if (path) {
      const dup = docsRef.current.find(
        (d) => d.fsPath && d.fsPath.toLowerCase() === path.toLowerCase())
      if (dup) { setActiveId(dup.id); return dup.id }
    }
    const id = 'd' + (++docSeq.current)
    setDocs((ds) => [...ds, { id, name, text: body, fsPath: path, dirty: false, sample: false }])
    setActiveId(id)
    richDirty.current = false // 换文档必须重建富文本内容
    return id
  }, [])

  /** 切换文档。内容已经在 docs 里，直接换 activeId 即可。 */
  const switchDoc = useCallback((id) => {
    setActiveId((cur) => {
      if (cur === id) return cur
      richDirty.current = false // 否则富文本编辑器会因为「自己敲过字」而拒绝重建
      return id
    })
  }, [])

  /** 关闭文档；最后一个关掉时留一个空文档，避免出现「没有文档」的状态。 */
  const closeDoc = useCallback((id) => {
    const idx = docs.findIndex((d) => d.id === id)
    if (idx < 0) return
    const doc = docs[idx]
    if (doc.dirty && !window.confirm(`「${doc.name}」有未保存的改动，确定关闭吗？`)) return
    const rest = docs.filter((d) => d.id !== id)
    if (rest.length === 0) {
      const nid = 'd' + (++docSeq.current)
      setDocs([{ id: nid, name: 'untitled.md', text: '', fsPath: null, dirty: false }])
      setActiveId(nid)
    } else {
      setDocs(rest)
      if (id === activeId) setActiveId(rest[Math.min(idx, rest.length - 1)].id)
    }
    richDirty.current = false
  }, [docs, activeId])
  const [mode, setMode] = useState('split')
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light')
  const [style, setStyle] = useState(() => {
    try {
      const saved = localStorage.getItem('mdr-style')
      // 校验一下：旧版本存过的风格 id 可能已经不存在了
      return STYLES.some((s) => s.id === saved) ? saved : 'autoclaw'
    } catch { return 'autoclaw' }
  })
  // 编辑器模式：源码 / 风格。默认源码，保持既有习惯。
  const [editorMode, setEditorMode] = useState('source')
  // 「风格」模式编辑区里的 HTML。只在**外部**换了文档、切了风格、或刚进风格模式时重建；
  // 用户自己在富文本里敲字时不重建 —— 否则 innerHTML 一重设，光标就跳到开头了。
  const [richHtml, setRichHtml] = useState('')
  const richDirty = useRef(false)
  // 分栏比例（0~1）与分隔条拖动状态
  const [splitRatio, setSplitRatio] = useState(0.5)
  const splitDragging = useRef(false)
  const bodyRef = useRef(null)
  // Radix Select 的下拉要 portal 到 .app 里面 —— 风格变量（--accent 等）挂在 .app 上，
  // portal 到 body 就拿不到，配色会掉回默认值。
  // 用 callback ref 存进 state，而不是 useRef：ref 的赋值时机和 portal 的渲染时机
  // 不一定对得上（踩过：用 appRef.current 传进去，Radix 仍然渲染到了 body）。
  const [portalHost, setPortalHost] = useState(null)
  const [dragging, setDragging] = useState(false)
  // 是否运行在 WebView2 桌面壳里。宿主对象**不在这里取** —— 见 getHostObject()。
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && !!window.chrome?.webview
  )
  // 文档属性弹层（用 Radix Dialog，内部渲染，不弹新窗口）
  const [propsOpen, setPropsOpen] = useState(false)
  const [diskInfo, setDiskInfo] = useState(null)
  // 阅读模式的目录（大纲）面板
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState([])
  const [activeHeading, setActiveHeading] = useState(null)
  // 侧栏日志面板
  const [logOpen, setLogOpen] = useState(false)
  const [logEntries, setLogEntries] = useState([])
  const logBodyRef = useRef(null)
  const fileInputRef = useRef(null)
  const cmRef = useRef(null)
  const previewRef = useRef(null)
  const editorScrollLock = useRef(false)

  const extensions = useMemo(() => markdown({ base: markdownLanguage, codeLanguages: languages }), [])

  // CodeMirror 只在「源码」模式下用；「风格」模式走上面的 RichEditor。
  const editorExtensions = useMemo(() => [extensions], [extensions])

  // 分栏分隔条：按下后在 window 上监听移动，按容器宽度算比例。
  // 夹在 15%~85% 之间，免得某一侧被拖到看不见。
  const onSplitDown = useCallback((e) => {
    e.preventDefault()
    splitDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      if (!splitDragging.current || !bodyRef.current) return
      const r = bodyRef.current.getBoundingClientRect()
      if (!r.width) return
      setSplitRatio(Math.min(0.85, Math.max(0.15, (e.clientX - r.left) / r.width)))
    }
    const onUp = () => {
      if (!splitDragging.current) return
      splitDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 进「风格」模式、切换风格、或外部换了文档 → 用渲染管线重建编辑区的 HTML。
  // richDirty 用来区分「这次 text 变化是富文本编辑器自己敲出来的」——那种情况不重建。
  useEffect(() => {
    if (editorMode !== 'style') return
    if (richDirty.current) { richDirty.current = false; return }
    setRichHtml(renderHtml(text, style))
  }, [editorMode, text, style, activeId])

  // 打开文件。桌面端走宿主的原生对话框 —— 网页的 <input type=file> 与拖放拿到的
  // File 对象**没有磁盘路径**，只有宿主那边知道，否则属性面板永远显示「尚未保存」。
  const openClicked = useCallback(() => {
    const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
    if (isDesktop && wv?.postMessage) {
      try { wv.postMessage({ type: 'openDialog' }); return } catch { /* 退回 input */ }
    }
    fileInputRef.current?.click()
  }, [isDesktop])

  const openFile = useCallback((file) => {
    if (!/\.md$|\.markdown$/i.test(file.name)) return
    const reader = new FileReader()
    reader.onload = () => {
      // WebView2 会给拖进来的 File 对象带上非标准的 path；浏览器里没有这个属性，
      // 那就是 null —— 属性面板会据此显示「浏览器不提供文件路径」。
      addDoc({ name: file.name, text: String(reader.result), fsPath: file.path || null })
    }
    reader.readAsText(file)
  }, [])

  // 保存失败的提示统一走这里：toast（sonner）+ 日志，不再只是 console.error
  const failSave = (msg) => {
    log.error('保存失败: ' + msg)
    toast.error('保存失败', { description: String(msg || '未知原因') })
  }

  /**
   * 桌面端保存：优先走消息通道（宿主在 NavigationCompleted 里声明 __hostVersion >= 2）。
   * 返回 null 表示「这不是桌面环境 / 宿主不支持」，调用方要退回浏览器路径。
   */
  const desktopSave = useCallback((payload) => new Promise((resolve) => {
    const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
    if (!wv?.postMessage || !(window.__hostVersion >= 2)) { resolve(null); return }
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      window.__saveResult = null
      resolve(r)
    }
    window.__saveResult = finish
    try {
      // 传对象而不是 JSON 字符串（见 log.js 里的说明）
      wv.postMessage(payload)
    } catch (err) {
      log.error('postMessage 失败', String(err))
      finish(null)
      return
    }
    // 兜底：宿主迟迟不回（旧版本 exe 等）时不要永久挂住
    setTimeout(() => { if (!settled) { log.warn('保存请求超时未收到宿主回传'); finish(null) } }, 180000)
  }), [])

  /**
   * 惰性获取宿主对象 —— 只作为旧版 exe 的兜底。
   * 刻意不在挂载时取：访问 hostObjects 会触发一次 IDispatch 往返，
   * 而实测这个对象的编组会异步抛 DISP_E_BADPARAMCOUNT，
   * 变成启动时一个没有栈的 unhandledrejection。
   */
  const getHostObject = useCallback(() => {
    try { return window.chrome?.webview?.hostObjects?.host ?? null } catch { return null }
  }, [])

  const saveFile = useCallback(async () => {
    // 1) 桌面端消息通道（首选）
    const r = await desktopSave({
      type: 'save',
      path: fsPath,               // 已有路径就直接覆盖，不弹窗
      name: fileName || 'untitled.md',
      content: text
    })
    if (r) {
      if (r.canceled) return
      if (!r.ok) { failSave(r.error || '宿主写入失败'); return }
      if (r.path !== fsPath) patchActive({ fsPath: r.path })
      patchActive({ name: r.path.split(/[\\/]/).pop() })
      patchActive({ dirty: false })
      log.info('已保存 ' + r.path)
      toast.success('已保存', { description: r.path })
      return
    }

    // 2) 桌面端宿主对象（旧版 exe 的兜底）
    const host = isDesktop ? getHostObject() : null
    if (host) {
      try {
        let target = fsPath
        if (!target) {
          target = await host.PickSavePath(fileName || 'untitled.md')
          if (!target) return
          patchActive({ fsPath: target })
          patchActive({ name: target.split(/[\\/]/).pop() })
        }
        const result = await host.WriteTextFile(target, text)
        if (result !== 'ok') { failSave(result); return }
        patchActive({ dirty: false })
        toast.success('已保存', { description: target })
        return
      } catch (err) {
        failSave(err?.message || String(err))
        return
      }
    }

    // 3) 浏览器
    downloadText(text, fileName || 'untitled.md')
    patchActive({ dirty: false })
    toast.success('已保存（下载）')
  }, [text, fileName, fsPath, isDesktop, getHostObject, desktopSave, patchActive])

  // 另存为：不管当前有没有磁盘路径，都重新选一次保存位置。
  const saveFileAs = useCallback(async () => {
    // 1) 桌面端消息通道（首选）：不带 path，宿主一定会弹「另存为」对话框
    const r = await desktopSave({
      type: 'save',
      name: fileName || 'untitled.md',
      content: text
    })
    if (r) {
      if (r.canceled) return
      if (!r.ok) { failSave(r.error || '宿主写入失败'); return }
      patchActive({ fsPath: r.path })
      patchActive({ name: r.path.split(/[\\/]/).pop() })
      patchActive({ dirty: false })
      log.info('另存为 ' + r.path)
      toast.success('已另存为', { description: r.path })
      return
    }

    // 2) 桌面端宿主对象（旧版 exe 的兜底）
    const host = isDesktop ? getHostObject() : null
    if (host) {
      try {
        const target = await host.PickSavePath(fileName || 'untitled.md')
        if (!target) return // 用户在对话框里取消
        const result = await host.WriteTextFile(target, text)
        if (result !== 'ok') { failSave(result); return }
        patchActive({ fsPath: target })
        patchActive({ name: target.split(/[\\/]/).pop() })
        patchActive({ dirty: false })
        toast.success('已另存为', { description: target })
        return
      } catch (err) {
        // 宿主对象不可用时明确报错，别再「点了没反应」
        failSave(err?.message || err)
        return
      }
    }
    // 浏览器：优先用文件系统访问 API（能真正选路径与文件名），不支持再退回下载
    if (typeof window !== 'undefined' && window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName || 'untitled.md',
          types: [
            { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }
          ]
        })
        const writable = await handle.createWritable()
        await writable.write(text)
        await writable.close()
        patchActive({ name: handle.name })
        patchActive({ dirty: false })
        toast.success('已另存为', { description: handle.name })
        return
      } catch (err) {
        if (err && err.name === 'AbortError') return // 用户取消，不算失败
        log.warn('showSaveFilePicker 不可用: ' + (err?.message || String(err)))
        // 其它情况退回下载
      }
    }
    downloadText(text, fileName || 'untitled.md')
    patchActive({ dirty: false })
    toast.success('已另存为（下载）')
  }, [text, fileName, isDesktop, getHostObject, desktopSave, patchActive])

  // 桌面模式：宿主注入文件 + 主题同步
  useEffect(() => {
    const wv = window.chrome?.webview ?? null
    setIsDesktop(!!wv)

    // 启动自检：把宿主桥的可用性写进日志。跨语言桥失败时天然是静默的，
    // 不打日志就只能靠猜（这次「保存失败」就吃了这个亏）。
    //
    // ⚠️ 这里刻意**不去碰 hostObjects**：WebView2 的宿主对象代理一被访问就会走
    //    IDispatch 往返，而它对我们这个对象的编组是有问题的 ——
    //    实测会异步抛 `DISP_E_BADPARAMCOUNT (0x8002000E)`，
    //    表现为一个没有栈的 unhandledrejection（控制台里只显示 [object Object]）。
    //    保存已经改走消息通道，完全不需要宿主对象；这里只判断 webview 在不在。
    const probe = () => ({
      webview: !!wv,
      hostVersion: window.__hostVersion ?? null,
      protocol: typeof location !== 'undefined' ? location.protocol : null
    })
    log.info('启动自检', probe())
    // 宿主在 NavigationCompleted 里才写 __hostVersion，晚一点再复检一次
    setTimeout(() => log.info('宿主桥复检', probe()), 1500)
    window.__setTheme = (t) => {
      setTheme(t)
      document.documentElement.dataset.theme = t
    }
    window.__dropDone = () => setDragging(false)
    // 关窗口前宿主会问：打开了哪些、哪些没保存
    window.__sessionInfo = () => ({
      dirty: docsRef.current.filter((d) => d.dirty).map((d) => d.name),
      files: docsRef.current.map((d) => d.fsPath).filter(Boolean)
    })
    // 关窗口时「保存并关闭」——有磁盘路径的直接写回，没有的跳过并提示
    window.__saveAll = async () => {
      let ok = 0
      let skipped = 0
      for (const d of docsRef.current) {
        if (!d.dirty) continue
        if (!d.fsPath) { skipped += 1; continue }
        const r = await desktopSave({ path: d.fsPath, name: d.name, content: d.text })
        if (r && r.ok !== false) {
          setDocs((ds) => ds.map((x) => (x.id === d.id ? { ...x, dirty: false } : x)))
          ok += 1
        }
      }
      if (skipped > 0) toast.warning(`${skipped} 个文档还没有磁盘路径，未能保存`)
      if (ok > 0) toast.success(`已保存 ${ok} 个文档`)
    }
    // 宿主从 CoreWebView2File 拿到路径后回填给对应的文档。
    // ⚠️ 宿主是 `window.__dropPath({id, path})` 这样调的（一个对象），
    //    这里必须按对象解构，写成两个形参收不到（踩过）。
    window.__dropPath = (payload) => {
      const id = payload && payload.id
      const path = payload && payload.path
      if (!id || !path) return
      setDocs((ds) => {
        // 拖进来的文件已经开着 → 切过去，并把刚建的这个空文档丢掉
        const dup = ds.find(
          (d) => d.id !== id && d.fsPath && d.fsPath.toLowerCase() === path.toLowerCase())
        if (dup) { setActiveId(dup.id); return ds.filter((d) => d.id !== id) }
        return ds.map((d) => (d.id === id ? { ...d, fsPath: path } : d))
      })
    }
    window.__openFile = (name, b64, path) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const content = new TextDecoder().decode(bytes)
      addDoc({ name, text: content, fsPath: path || null })
    }
  }, [])

  // 日志面板：打开时拉一次快照，并订阅后续新增（关闭时取消订阅）
  useEffect(() => {
    if (!logOpen) return undefined
    setLogEntries(log.all())
    return log.subscribe(() => setLogEntries(log.all()))
  }, [logOpen])

  // 有新日志就滚到底部
  useEffect(() => {
    const el = logBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logEntries, logOpen])

  // 拖文件进窗口直接打开
  useEffect(() => {
    const over = (e) => { e.preventDefault(); setDragging(true) }
    const leave = (e) => { if (e.relatedTarget === null) setDragging(false) }
    const drop = (e) => {
      e.preventDefault(); setDragging(false)
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
      if (wv?.postMessage) {
        // 桌面端：网页拿不到磁盘路径，但把 File 对象放进消息里发给宿主，
        // WebView2 会把它还原成 CoreWebView2File（带 Path）—— 这是平台给的正路。
        // ⚠️ 消息必须在**当前事件循环里同步发出**：拖放事件一结束，File 对象就失效了，
        //    放到 FileReader.onload 里再发就太晚（宿主拿不到 AdditionalObjects）。
        const id = addDoc({ name: f.name, text: '' })
        try {
          // postMessageWithAdditionalObjects 才是 WebView2 传 File 对象的正规 API，
          // 宿主侧从 args.AdditionalObjects 拿到 CoreWebView2File（带 Path）。
          if (typeof wv.postMessageWithAdditionalObjects === 'function') {
            wv.postMessageWithAdditionalObjects({ type: 'dropFile', docId: id }, [f])
          } else {
            wv.postMessage({ type: 'dropFile', docId: id, file: f })
          }
        } catch { /* 宿主拿不到路径时退化为「未关联磁盘文件」 */ }
        const reader = new FileReader()
        reader.onload = () => {
          setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, text: String(reader.result) } : d)))
        }
        reader.readAsText(f)
        return
      }
      openFile(f)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [openFile])

  // Ctrl+S 保存 / Ctrl+O 打开
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveFile()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        fileInputRef.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveFile])

  // 编辑 → 预览滚动同步（比例映射）
  const onEditorScroll = useCallback((scrollInfo) => {
    if (editorScrollLock.current || mode !== 'split') return
    const preview = previewRef.current
    if (!preview) return
    editorScrollLock.current = true
    setTimeout(() => { editorScrollLock.current = false }, 80)
    const ratio = scrollInfo.top / Math.max(1, scrollInfo.scrollHeight - scrollInfo.clientHeight)
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight)
  }, [mode])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('mdr-theme', next) } catch {}
  }

  const changeStyle = (id) => {
    setStyle(id)
    try { localStorage.setItem('mdr-style', id) } catch {}
  }

  // 终端形态不加载 KaTeX（公式退回原始 TeX 源码）；代码高亮 12 种风格全开
  /** 跑一遍完整的渲染管线，得到预览的 React 树。 */
  const buildPreview = useCallback((md, st) => {
    const remarkPlugins = [remarkGfm]
    const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema]]
    if (!TERMINAL_STYLES.has(st)) {
      remarkPlugins.push(remarkMath)
      rehypePlugins.push(rehypeKatex)
    }
    rehypePlugins.push([rehypeHighlight, { detect: true, ignoreMissing: true }])
    return (
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {md}
      </ReactMarkdown>
    )
  }, [])

  // 预览结果**刻意不用 useMemo 同步算**：整篇文档跑一遍 remark/rehype 在文档较大时
  // 要几十到几百毫秒，同步算会把「切文档」和「敲键」一起卡住（用户反馈切换卡顿）。
  // 推迟一个 tick 后，编辑区先切过去、预览随后补上，手感上就不卡了。
  // 首屏**不同步**渲染 markdown：先让界面出来，预览下一个 tick 再补 ——
  // 同步跑首屏是启动卡顿的主要来源之一。
  const [renderers, setRenderers] = useState(null)
  useEffect(() => {
    let cancelled = false
    const id = setTimeout(() => {
      if (!cancelled) setRenderers(buildPreview(text, style))
    }, 0)
    return () => { cancelled = true; clearTimeout(id) }
  }, [text, style, buildPreview])

  // 目录：从**渲染后的 DOM** 里抽取标题，这样和预览里看到的完全一致
  // （直接解析 Markdown 会把代码块里的 # 也算进去）。
  useEffect(() => {
    // ⚠️ 等一帧再读 DOM：拖入文件时内容分两步进来（先空、后填充），
    //    且预览渲染本身是延后一个 tick 的 —— 立刻读会读到上一版内容，
    //    表现为「第一次拖进来点目录没有标题」（踩过）。
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const root = previewRef.current?.querySelector('.preview-body')
      if (!root) { setToc([]); return }
      const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      heads.forEach((h, i) => { if (!h.id) h.id = 'mdr-h-' + i })
      setToc(heads.map((h) => ({
        id: h.id,
        level: Number(h.tagName[1]),
        text: (h.textContent || '').trim()
      })))
    })
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [renderers, text, activeId])

  // 滚动时高亮当前所在的小节
  useEffect(() => {
    const pane = previewRef.current
    if (!pane || toc.length === 0) return undefined
    const onScroll = () => {
      const paneTop = pane.getBoundingClientRect().top
      let cur = toc[0].id
      for (const t of toc) {
        const el = document.getElementById(t.id)
        if (el && el.getBoundingClientRect().top - paneTop <= 16) cur = t.id
        else break
      }
      setActiveHeading(cur)
    }
    pane.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => pane.removeEventListener('scroll', onScroll)
  }, [toc])

  // 点目录跳转：预览面板自己就是滚动容器
  const goToHeading = useCallback((id) => {
    const pane = previewRef.current
    const el = document.getElementById(id)
    if (!pane || !el) return
    const delta = el.getBoundingClientRect().top - pane.getBoundingClientRect().top
    pane.scrollTo({ top: pane.scrollTop + delta - 12, behavior: 'smooth' })
    setActiveHeading(id)
  }, [])

  const styleDesc = STYLES.find((s) => s.id === style)?.desc
  // 只在属性面板打开时才算 UTF-8 字节数（文档可能很大，没必要一直算）
  const utf8Bytes = useMemo(
    () => (propsOpen ? new TextEncoder().encode(text).length : 0),
    [text, propsOpen]
  )

  // 终端风格下整个窗口强制暗色：预览区、标题栏、状态栏、左侧编辑器一起变暗。
  // 只让预览区变黑的话，编辑器那半边还是白的，窗口一半黑一半白对比更难看。
  const forceDark = TERMINAL_STYLES.has(style)
  const editorTheme = theme === 'dark' || forceDark ? 'dark' : 'light'

  // 把当前主题与配色同步给桌面壳的原生标题栏。
  // 标题栏默认跟随「系统」主题，而应用有自己的明暗开关 —— 不同步就会出现
  // 「窗口内部已经切到暗色，标题栏还是亮的」，这就是用户说的「不统一」。
  useEffect(() => {
    if (!portalHost) return
    const wv = window.chrome?.webview
    if (!wv?.postMessage) return
    // WPF 的 ColorConverter 不认 rgb() / color-mix()，所以把 CSS 变量解析成 #RRGGBB
    const read = (name) => {
      const probe = document.createElement('span')
      probe.style.cssText = `display:none;color:var(${name})`
      portalHost.appendChild(probe)
      const rgb = getComputedStyle(probe).color
      probe.remove()
      const m = rgb.match(/\d+/g)
      if (!m || m.length < 3) return null
      return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    }
    try {
      wv.postMessage({
        type: 'theme',
        mode: forceDark || theme === 'dark' ? 'dark' : 'light',
        bg: read('--panel'),
        fg: read('--text'),
        bd: read('--border'),
        ac: read('--accent'),
        // 窗口/根 Grid 的底色 —— WebView2 那圈 6px 缩放边带露出的就是它
        win: read('--bg')
      })
    } catch { /* 浏览器里没有这个通道 */ }
  }, [portalHost, theme, style, forceDark])

  // 文档列表 → 原生标题栏上的标签。
  // 依赖用「签名」而不是 docs 本身：docs 每次敲键都会变，直接依赖会一发一消息。
  // ⚠️ 必须带上 fsPath：拖入文件时路径是**后补**的（__dropPath），
  //    签名不含路径就不会触发上报 → 宿主拿不到「已落盘的文件」→
  //    关闭时把空列表写进 session.json → 下次恢复不了（日志里抓到的）。
  const docsSig =
    docs.map((d) => d.id + ':' + d.name + ':' + (d.dirty ? '1' : '0') + ':' + (d.fsPath || '')).join('|') +
    '#' + activeId
  useEffect(() => {
    const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
    if (!wv?.postMessage) return
    try {
      wv.postMessage({
        type: 'docs',
        list: docs.map((d) => ({
          id: d.id,
          label: d.name + (d.dirty ? ' •' : ''),
          active: d.id === activeId
        }))
      })
    } catch { /* 浏览器无此通道 */ }
  }, [docsSig])

  // 随时把「已落盘的文件列表」报给宿主，供下次启动恢复（不依赖关闭流程）
  useEffect(() => {
    const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
    if (!wv?.postMessage) return
    try {
      wv.postMessage({
        type: 'session',
        files: docs.map((d) => d.fsPath).filter(Boolean),
        dirty: docs.filter((d) => d.dirty).map((d) => d.name)
      })
    } catch { /* 浏览器无此通道 */ }
  }, [docsSig])

  // 宿主（原生标题栏的标签）点击后回调这两个
  useEffect(() => {
    window.__switchDoc = switchDoc
    window.__closeDoc = closeDoc
  }, [switchDoc, closeDoc])

  // 把当前文档名同步给原生标题栏（窗口标题也跟着变）
  useEffect(() => {
    const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
    if (!wv?.postMessage) return
    try { wv.postMessage({ type: 'title', name: fileName, dirty }) } catch { /* 浏览器无此通道 */ }
  }, [fileName, dirty])

  // 打开属性面板时，向宿主问一次磁盘上的文件信息（浏览器里没有，跳过）
  useEffect(() => {
    if (!propsOpen) return undefined
    setDiskInfo(null)
    const wv = window.chrome?.webview
    if (!fsPath || !wv?.postMessage) return undefined
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      window.__statResult = null
      setDiskInfo(r)
    }
    window.__statResult = finish
    try { wv.postMessage({ type: 'stat', path: fsPath }) } catch { finish(null) }
    const timer = setTimeout(() => finish(null), 5000)
    return () => { clearTimeout(timer); if (!settled) { settled = true; window.__statResult = null } }
  }, [propsOpen, fsPath])

  // 在资源管理器中定位当前文件
  const revealInExplorer = useCallback(() => {
    const wv = typeof window !== 'undefined' ? window.chrome?.webview : null
    if (!fsPath || !wv?.postMessage) return
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      window.__revealResult = null
      if (r && r.ok === false) toast.error('无法在资源管理器中打开', { description: r.error })
    }
    window.__revealResult = finish
    try { wv.postMessage({ type: 'reveal', path: fsPath }) } catch { finish(null) }
    setTimeout(() => finish(null), 5000)
  }, [fsPath, patchActive])

  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={250}>
    <div
      ref={(el) => { setPortalHost(el); tipHost = el }}
      className={'app style-' + style + (forceDark ? ' terminal-mode' : '') + (dragging ? ' dragging' : '')}
      data-style={style}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo">M↓</span>
          {/* 文档属性按钮：放在文件名左侧 */}
          <Tip label="文档属性">
            <button
              className="btn icon"
              onClick={() => setPropsOpen(true)}
              aria-label="文档属性"
            >
              <Info size={14} strokeWidth={2.25} />
            </button>
          </Tip>
          {/* 多文档标签：桌面端的标签在**原生标题栏**上，这里只在浏览器里显示，
              避免同一件事出现两套 UI */}
          <div className="tabs" role="tablist" style={isDesktop ? { display: 'none' } : undefined}>
            {docs.map((d) => (
              <Tip key={d.id} label={d.name}>
                <div
                  role="tab"
                  aria-selected={d.id === activeId}
                  className={'tab' + (d.id === activeId ? ' active' : '')}
                  onClick={() => switchDoc(d.id)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeDoc(d.id) } }}
                >
                  <span className="tab-name">{d.name}{d.dirty ? ' •' : ''}</span>
                  <Tip label="关闭">
                    <button
                      className="tab-close"
                      onClick={(e) => { e.stopPropagation(); closeDoc(d.id) }}
                      aria-label={'关闭 ' + d.name}
                    ><X size={11} strokeWidth={2.5} /></button>
                  </Tip>
                </div>
              </Tip>
            ))}
            <Tip label="新建文档">
              <button
                className="tab-new"
                onClick={() => addDoc({ name: 'untitled.md', text: '' })}
                aria-label="新建文档"
              ><Plus size={13} strokeWidth={2.5} /></button>
            </Tip>
          </div>
        </div>
        <div className="actions">
          {(mode === 'edit' || mode === 'split') && (
            <Tip label="编辑器模式：源码 = 原样显示 Markdown 记号；风格 = 完全渲染后的样子，可直接编辑">
            <div className="seg">
              {EDITOR_MODES.map((m) => (
                <button
                  key={m.id}
                  className={'seg-btn' + (editorMode === m.id ? ' active' : '')}
                  onClick={() => setEditorMode(m.id)}
                >{m.label}</button>
              ))}
            </div>
            </Tip>
          )}
          <div className="seg">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={'seg-btn' + (mode === m.id ? ' active' : '')}
                onClick={() => setMode(m.id)}
              >{m.label}</button>
            ))}
          </div>
          <button className="btn" onClick={openClicked}>
            <FolderOpen size={14} strokeWidth={2.25} />打开
          </button>
          <button className="btn primary" onClick={saveFile}>
            <Save size={14} strokeWidth={2.25} />保存
          </button>
          <button className="btn" onClick={saveFileAs}>
            <SaveAll size={14} strokeWidth={2.25} />另存为
          </button>
          {/* 风格下拉：用 Radix Select 而不是原生 <select> ——
              原生 select 的下拉列表由操作系统渲染，CSS 管不到，
              列表底色 / 条目高亮永远和我们的主题对不上。 */}
          <Select.Root value={style} onValueChange={changeStyle}>
            <Tip label="渲染风格">
            <Select.Trigger className="sel-trigger" aria-label="渲染风格">
              <Select.Value />
              <Select.Icon className="sel-icon">
                <ChevronDown size={13} strokeWidth={2.25} />
              </Select.Icon>
            </Select.Trigger>
            </Tip>
            <Select.Portal container={portalHost ?? undefined}>
              <Select.Content className="sel-content" position="popper" sideOffset={5} align="end">
                <Select.Viewport className="sel-viewport">
                  {STYLE_GROUPS.map((g) => (
                    <Select.Group key={g.label}>
                      <Select.Label className="sel-label">{g.label}</Select.Label>
                      {g.items.map((s) => (
                        <Select.Item key={s.id} value={s.id} className="sel-item">
                          <Select.ItemIndicator className="sel-check">
                            <Check size={12} strokeWidth={2.75} />
                          </Select.ItemIndicator>
                          <Select.ItemText>{s.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Group>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <Tip label={theme === 'dark' ? '切换到亮色' : '切换到暗色'}>
            <button className="btn icon" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={15} strokeWidth={2.25} /> : <Moon size={15} strokeWidth={2.25} />}
            </button>
          </Tip>
          {(mode === 'read' || mode === 'split') && (
            <Tip label="显示文档目录（大纲）">
              <button
                className={'btn icon' + (tocOpen ? ' on' : '')}
                onClick={() => setTocOpen((v) => !v)}
              >
                <ListTree size={15} strokeWidth={2.25} />
              </button>
            </Tip>
          )}
          <Tip label="侧栏显示运行日志（排查问题用）">
            <button
              className={'btn icon' + (logOpen ? ' on' : '')}
              onClick={() => setLogOpen((v) => !v)}
            >
              <ScrollText size={15} strokeWidth={2.25} />
            </button>
          </Tip>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }}
          />
        </div>
      </header>

      <div className="workarea">
        {tocOpen && (
          <aside className="toc-panel">
            <div className="toc-head">
              <ListTree size={13} strokeWidth={2.25} />
              <span className="toc-title">目录</span>
              <span className="toc-count">{toc.length}</span>
              <span className="spacer" />
              <Tip label="关闭">
                <button className="toc-act" onClick={() => setTocOpen(false)}>
                  <X size={13} strokeWidth={2.25} />
                </button>
              </Tip>
            </div>
            <div className="toc-body">
              {toc.length === 0 && <div className="toc-empty">此文档没有标题</div>}
              {toc.map((t) => (
                <button
                  key={t.id}
                  className={'toc-item lv' + t.level + (t.id === activeHeading ? ' active' : '')}
                  onClick={() => goToHeading(t.id)}
                  title={t.text}
                >
                  {t.text}
                </button>
              ))}
            </div>
          </aside>
        )}
        <main
          className={'body mode-' + mode}
          ref={bodyRef}
          style={{ '--split': (splitRatio * 100).toFixed(2) + '%' }}
        >
          {(mode === 'edit' || mode === 'split') && (
            // 风格模式下面板也带 `preview` class —— 与阅读模式的 .pane.preview 完全对齐，
            // 字号 / 行高 / 内边距 / 底色 / 滚动行为都走同一批规则。
            <section className={'pane editor' + (editorMode === 'style' ? ' editor-styled preview' : '')}>
              {editorMode === 'style' ? (
                <>
                  <div className="fmt-bar">
                    {FORMAT_BUTTONS.map(({ id, Icon, title, run }) => (
                      <Tip key={id} label={title}>
                        <button
                          className="fmt-btn"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={run}
                        ><Icon size={14} strokeWidth={2.25} /></button>
                      </Tip>
                    ))}
                    <span className="fmt-hint">
                      编辑区就是渲染后的样子，可以直接改；选中文字后 Ctrl+B / I / U / E
                    </span>
                  </div>
                  <RichEditor
                    html={richHtml}
                    onChange={(md) => { richDirty.current = true; patchActive({ text: md, dirty: true }) }}
                    onKeyDown={(e) => {
                      if (!(e.ctrlKey || e.metaKey)) return
                      const k = e.key.toLowerCase()
                      if (k === 'b') { e.preventDefault(); richCmd('bold') }
                      else if (k === 'i') { e.preventDefault(); richCmd('italic') }
                      else if (k === 'u') { e.preventDefault(); richCmd('underline') }
                      else if (k === 'e') { e.preventDefault(); richInlineCode() }
                    }}
                  />
                </>
              ) : (
                <CodeMirror
                  ref={cmRef}
                  value={text}
                  theme={editorTheme}
                  extensions={editorExtensions}
                  onChange={(v) => { patchActive({ text: v, dirty: true }) }}
                  onScroll={onEditorScroll}
                  height="100%"
                  basicSetup={{ foldGutter: false, autocompletion: false }}
                />
              )}
            </section>
          )}
          {mode === 'split' && (
            <Tip label="左右拖动调整比例，双击复位为 1:1">
              <div
                className="splitter"
                onMouseDown={onSplitDown}
                onDoubleClick={() => setSplitRatio(0.5)}
              />
            </Tip>
          )}
          {(mode === 'read' || mode === 'split') && (
            <section className="pane preview" ref={previewRef}>
              <div className="preview-body">{renderers}</div>
            </section>
          )}
        </main>
      {logOpen && (
        <aside className="log-panel">
          <div className="log-head">
            <ScrollText size={13} strokeWidth={2.25} />
            <span className="log-title">日志</span>
            <span className="log-count">{logEntries.length}</span>
            <span className="spacer" />
            <Tip label="清空日志">
              <button
                className="log-act"
                onClick={() => { log.clear(); setLogEntries(log.all()) }}
              ><Trash2 size={13} strokeWidth={2.25} /></button>
            </Tip>
            <Tip label="关闭">
              <button className="log-act" onClick={() => setLogOpen(false)}>
                <X size={13} strokeWidth={2.25} />
              </button>
            </Tip>
          </div>
          <div className="log-body" ref={logBodyRef}>
            {logEntries.length === 0 && <div className="log-empty">暂无日志</div>}
            {logEntries.map((e, i) => (
              <div className={'log-row lv-' + e.level} key={i}>
                <span className="log-time">{e.t.slice(11)}</span>
                <span className="log-lv">{e.level}</span>
                <span className="log-msg">{e.msg}</span>
                {e.extra != null && (
                  <div className="log-extra">
                    {typeof e.extra === 'string' ? e.extra : JSON.stringify(e.extra, null, 1)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
      </div>

      <footer className="statusbar">
        <span>{text.length.toLocaleString()} 字符</span>
        <span>{text.split('\n').length.toLocaleString()} 行</span>
        <span>{(text.match(/\S+/g) || []).length.toLocaleString()} 词</span>
        <span className="spacer" />
        <Tip label={styleDesc} side="top">
          <span className="rich-muted">{styleDesc}</span>
        </Tip>
      </footer>

      {dragging && (
        <div className="drop-hint">
          <div className="drop-card">松开以打开 .md 文件</div>
        </div>
      )}

      {/* 文档属性：Radix Dialog，在页面内部渲染（portal 进 .app 以继承风格变量） */}
      <Dialog.Root open={propsOpen} onOpenChange={setPropsOpen}>
        <Dialog.Portal container={portalHost ?? undefined}>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg-content">
            <Dialog.Title className="dlg-title">文档属性</Dialog.Title>
            <Dialog.Description className="dlg-desc">{fileName}</Dialog.Description>

            <dl className="prop-list">
              <div className="prop-row"><dt>文件名</dt><dd>{fileName}</dd></div>
              <div className="prop-row">
                <dt>位置</dt>
                <dd className={fsPath ? '' : 'prop-muted'}>
                  {fsPath ||
                    (activeDoc?.sample
                      ? `内置示例（编译在程序内，非磁盘文件）${window.__exePath ? '；程序位置 ' + window.__exePath : ''}`
                      : isDesktop
                        ? '尚未保存到磁盘'
                        : '浏览器不提供文件路径')}
                </dd>
              </div>
              <div className="prop-row">
                <dt>大小</dt>
                <dd>
                  {diskInfo?.exists
                    ? `${diskInfo.size.toLocaleString()} 字节`
                    : `${utf8Bytes.toLocaleString()} 字节`}
                  <span className="prop-muted">
                    {diskInfo?.exists ? '（磁盘文件）' : '（UTF-8，尚未落盘）'}
                  </span>
                </dd>
              </div>
              <div className="prop-row"><dt>字符</dt><dd>{text.length.toLocaleString()}</dd></div>
              <div className="prop-row"><dt>行数</dt><dd>{text.split('\n').length.toLocaleString()}</dd></div>
              <div className="prop-row"><dt>词数</dt><dd>{(text.match(/\S+/g) || []).length.toLocaleString()}</dd></div>
              <div className="prop-row">
                <dt>状态</dt>
                <dd>{dirty ? '有未保存的改动' : '已保存'}</dd>
              </div>
              {diskInfo?.exists && (
                <div className="prop-row"><dt>最后修改</dt><dd>{diskInfo.mtime}</dd></div>
              )}
            </dl>

            <div className="dlg-actions">
              <Tip
                label={!fsPath ? '文件还没保存到磁盘，先保存一次' : '在资源管理器中选中此文件'}
                side="top"
              >
                <button
                  className="btn"
                  onClick={revealInExplorer}
                  disabled={!fsPath || !diskInfo?.exists}
                >
                  <FolderOpen size={14} strokeWidth={2.25} />在资源管理器中打开
                </button>
              </Tip>
              <Dialog.Close asChild>
                <button className="btn primary">关闭</button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 提示统一用 sonner，不再自绘 */}
      <Toaster
        position="bottom-right"
        theme={forceDark || theme === 'dark' ? 'dark' : 'light'}
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
    </div>
    </Tooltip.Provider>
  )
}
