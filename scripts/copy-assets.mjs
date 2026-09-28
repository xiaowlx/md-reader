// 把 dist/index.html 拷贝到 WPF 工程的 Assets/reader.html（嵌入 exe）
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const destDir = join(root, 'desktop', 'Assets')
mkdirSync(destDir, { recursive: true })
copyFileSync(join(root, 'dist', 'index.html'), join(destDir, 'reader.html'))
console.log('copied dist/index.html -> desktop/Assets/reader.html')
