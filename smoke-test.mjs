import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { SAMPLE } from './src/sample.js'
import { schema } from './src/schema.js'

const html = renderToStaticMarkup(
  React.createElement(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [
        rehypeRaw,
        [rehypeSanitize, schema],
        rehypeKatex,
        [rehypeHighlight, { detect: true, ignoreMissing: true }]
      ]
    },
    SAMPLE
  )
)

const checks = {
  'GFM 表格': html.includes('<table>'),
  '任务列表复选框': html.includes('checkbox'),
  'KaTeX 公式': html.includes('katex'),
  '代码高亮 hljs': html.includes('hljs'),
  'rich-card 保留': html.includes('rich-card'),
  'rich-timeline 保留': html.includes('rich-timeline'),
  'rich-badge 保留': html.includes('rich-badge'),
  'step-marker 保留': html.includes('rich-step-marker'),
  '无 script 注入': !html.includes('<script'),
  '无 onerror 注入': !html.includes('onerror')
}
let fail = 0
for (const [k, v] of Object.entries(checks)) {
  console.log((v ? 'PASS' : 'FAIL') + '  ' + k)
  if (!v) fail++
}
console.log(fail === 0 ? 'ALL PASS' : fail + ' checks failed')
process.exit(fail === 0 ? 0 : 1)
