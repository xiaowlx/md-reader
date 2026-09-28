import { defaultSchema } from 'rehype-sanitize'

// 在 rehype-sanitize 默认白名单基础上放开 class/style/id，
// 让 AutoClaw 风格的 rich-* 结构化 HTML 和代码高亮 class 能存活，
// 同时仍然剥掉 script/iframe/事件属性。
export const schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'div', 'span', 'section', 'figure', 'figcaption',
    'mark', 'u', 'ins', 'details', 'summary', 'kbd'
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'style', 'id']
  }
}
