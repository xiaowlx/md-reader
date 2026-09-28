// HTML → Markdown 序列化。
//
// 「风格」模式是所见即所得的富文本编辑器，DOM 里是渲染后的 HTML；
// 保存/切换时需要把它写回 Markdown 源码。这个模块就负责这件事。
//
// 原则：
//   1. 只覆盖本应用渲染管线（remark-gfm + remark-math + rehype-*）会产出的节点。
//   2. 遇到不认识的元素就下钻取文本，不丢内容。
//   3. rich-* 这类结构化 HTML 积木**整体原样保留** —— 应用开了 rehype-raw，
//      原始 HTML 能原样再渲染回来，没必要翻译成 Markdown。
//   4. KaTeX 渲染出来的公式能从 <annotation encoding="application/x-tex"> 里
//      把原始 LaTeX 取回来，所以数学公式能无损往返。

// 行内文本里会被 Markdown 当成语法的字符要转义，否则往返一次语义就变了。
const NEEDS_ESCAPE = /([\\`*_])/g
const esc = (s) => s.replace(NEEDS_ESCAPE, '\\$1')

const isEl = (n) => n && n.nodeType === 1
const tagOf = (n) => (isEl(n) ? n.tagName.toLowerCase() : '')
const cls = (n) => (isEl(n) && typeof n.className === 'string' ? n.className : '')

/** 取元素的纯行内 Markdown 文本。 */
function inlineOf(node) {
  let out = ''
  node.childNodes.forEach((c) => { out += inlineNode(c) })
  return out
}

function inlineNode(n) {
  if (n.nodeType === 3) return esc(n.nodeValue.replace(/\s+/g, ' '))
  if (!isEl(n)) return ''

  // KaTeX：从 annotation 里取回原始 TeX，保证公式无损往返
  if (cls(n).split(/\s+/).includes('katex')) {
    const ann = n.querySelector('annotation[encoding="application/x-tex"]')
    const tex = ann ? ann.textContent : ''
    const display = n.parentElement && cls(n.parentElement).includes('katex-display')
    return display ? `$$${tex}$$` : `$${tex}$`
  }
  // KaTeX 的视觉副本（.katex-html）不要重复取
  if (cls(n).split(/\s+/).includes('katex-html')) return ''

  switch (tagOf(n)) {
    case 'strong': case 'b': return '**' + inlineOf(n) + '**'
    case 'em': case 'i': return '*' + inlineOf(n) + '*'
    case 'u': case 'ins': return '<u>' + inlineOf(n) + '</u>'
    case 'del': case 's': case 'strike': return '~~' + inlineOf(n) + '~~'
    case 'code': return '`' + n.textContent + '`'
    case 'a': return '[' + inlineOf(n) + '](' + (n.getAttribute('href') || '') + ')'
    case 'img': return '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '') + ')'
    case 'br': return '\n'
    default: return inlineOf(n)
  }
}

/** 列表（含嵌套与 GFM 任务列表）。 */
function serializeList(listEl, out, depth) {
  const ordered = tagOf(listEl) === 'ol'
  const indent = '  '.repeat(depth)
  let i = 1
  for (const li of listEl.children) {
    if (tagOf(li) !== 'li') continue
    const marker = ordered ? `${i++}. ` : '- '
    const box = li.querySelector(':scope > input[type="checkbox"]')
    const prefix = box ? (box.checked ? '[x] ' : '[ ] ') : ''
    let text = ''
    for (const c of li.childNodes) {
      if (isEl(c) && ['ul', 'ol', 'input'].includes(tagOf(c))) continue
      text += inlineNode(c)
    }
    out.push(indent + marker + prefix + text.trim())
    for (const c of li.children) {
      if (tagOf(c) === 'ul' || tagOf(c) === 'ol') serializeList(c, out, depth + 1)
    }
  }
}

/** GFM 表格。 */
function serializeTable(t, out) {
  const rows = [...t.querySelectorAll('tr')]
  if (!rows.length) return
  const cells = (tr) =>
    [...tr.children].map((td) => inlineOf(td).trim().replace(/\|/g, '\\|'))
  const head = cells(rows[0])
  out.push('| ' + head.join(' | ') + ' |')
  out.push('| ' + head.map(() => '---').join(' | ') + ' |')
  for (let i = 1; i < rows.length; i++) out.push('| ' + cells(rows[i]).join(' | ') + ' |')
}

/** 块级元素 → Markdown 行数组。 */
function serializeBlock(n, out) {
  if (n.nodeType === 3) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim()
    if (t) out.push(esc(t), '')
    return
  }
  if (!isEl(n)) return

  const tag = tagOf(n)
  const klass = cls(n)

  // rich-* 结构化积木：原样保留 HTML
  if (/(^|\s)rich-[a-z-]+/.test(klass) || klass.startsWith('autoclaw-')) {
    out.push(n.outerHTML, '')
    return
  }

  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      out.push('#'.repeat(Number(tag[1])) + ' ' + inlineOf(n).trim(), '')
      return
    case 'p':
      out.push(inlineOf(n).trim(), '')
      return
    case 'hr':
      out.push('---', '')
      return
    case 'pre': {
      const code = n.querySelector('code')
      const lang = ((code && cls(code)) || '').match(/language-([\w-]+)/)
      const body = (code ? code.textContent : n.textContent).replace(/\n+$/, '')
      out.push('```' + (lang ? lang[1] : ''), body, '```', '')
      return
    }
    case 'blockquote': {
      const inner = []
      n.childNodes.forEach((c) => serializeBlock(c, inner))
      while (inner.length && inner[inner.length - 1] === '') inner.pop()
      inner.forEach((l) => out.push(l ? '> ' + l : '>'))
      out.push('')
      return
    }
    case 'ul': case 'ol':
      serializeList(n, out, 0)
      out.push('')
      return
    case 'table':
      serializeTable(n, out)
      out.push('')
      return
    case 'div': case 'section': case 'article': case 'main': case 'header': case 'footer':
      // 普通容器：继续下钻，不额外加空行
      n.childNodes.forEach((c) => serializeBlock(c, out))
      return
    default: {
      const t = inlineOf(n).trim()
      if (t) out.push(t, '')
    }
  }
}

/** 入口：把渲染后的 HTML 根节点写回 Markdown。 */
export function htmlToMarkdown(root) {
  const out = []
  root.childNodes.forEach((c) => serializeBlock(c, out))
  // 合并连续空行、去掉尾部空行
  const lines = []
  for (const l of out) {
    if (l === '' && lines[lines.length - 1] === '') continue
    lines.push(l)
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.length ? lines.join('\n') + '\n' : ''
}
