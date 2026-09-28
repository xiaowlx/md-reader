// 轻量日志系统。
//
// 目的：以前出错只在 console 里（桌面端更是完全看不见），排查全靠猜。
// 现在统一走这里：
//   - 内存环形缓冲（最近 500 条）→ 界面上的「日志」面板可读
//   - console → 浏览器里直接可见
//   - 桌面端经 WebView2 消息通道转发给宿主 → 落盘到 <MdReader-data>/logs/app-YYYY-MM-DD.log
// 另外在模块加载时挂上全局 error / unhandledrejection 捕获 —— 跨语言调用
// （宿主对象、COM 桥）失败时天然是未捕获的 Promise 拒绝，不捕获就毫无痕迹。

const MAX = 500
const buf = []
const listeners = new Set()

const pad = (n, w = 2) => String(n).padStart(w, '0')

function stamp() {
  const d = new Date()
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

function emit(level, msg, extra) {
  const entry = { t: stamp(), level, msg, extra: extra === undefined ? null : extra }
  buf.push(entry)
  if (buf.length > MAX) buf.shift()

  const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  try {
    console[fn](`[${level}] ${msg}`, ...(extra === undefined ? [] : [extra]))
  } catch { /* 控制台不可用不能影响主流程 */ }

  // 转发给宿主落盘。
  // ⚠️ 直接传对象，不要 JSON.stringify：传字符串的话宿主侧 WebMessageAsJson
  //    会变成「JSON 字符串」，TryGetProperty 会抛异常（已经踩过一次）。
  try {
    window.chrome?.webview?.postMessage?.({ type: 'log', ...entry })
  } catch { /* 浏览器里没有这个通道 */ }

  listeners.forEach((l) => { try { l(entry) } catch { /* 订阅者异常不影响其它订阅者 */ } })
}

/** 把任意异常对象尽量完整地转成可读文本（宿主对象拒绝时常常不是 Error 实例）。 */
function describe(err) {
  if (err === null || err === undefined) return String(err)
  if (err instanceof Error) return err.stack || err.message
  try {
    const s = JSON.stringify(err)
    // JSON.stringify 对普通对象有效；对宿主对象代理可能返回 "{}"
    return s && s !== '{}' ? s : Object.prototype.toString.call(err)
  } catch {
    return Object.prototype.toString.call(err)
  }
}

// 全局兜底捕获
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    emit('error', `window.error: ${e.message || '(无消息)'}`, e.error?.stack || `${e.filename}:${e.lineno}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    emit('error', `unhandledrejection: ${r?.message || String(r)}`, describe(r))
  })
}

export const log = {
  info: (msg, extra) => emit('info', msg, extra),
  warn: (msg, extra) => emit('warn', msg, extra),
  error: (msg, extra) => emit('error', msg, extra),
  /** 返回当前缓冲的副本（旧的在前）。 */
  all: () => buf.slice(),
  /** 订阅新日志，返回取消订阅函数。 */
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  clear() {
    buf.length = 0
    listeners.forEach((l) => { try { l(null) } catch { /* ignore */ } })
  }
}

// 暴露到全局，方便排查：控制台里执行 __mdrLog.all() 就能看到全部日志
if (typeof window !== 'undefined') window.__mdrLog = log
