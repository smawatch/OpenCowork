import type { OutputData } from '@editorjs/editorjs'

interface EditorJsBlock {
  type: string
  data: Record<string, unknown>
}

/**
 * 将 EditorJS 的 HTML 格式文本转换为 Markdown
 * EditorJS 使用 HTML 标签来表示富文本格式
 */
function htmlToMarkdown(html: string): string {
  if (!html) return ''
  let text = html

  // 处理粗体 <b> 和 <strong>
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**')
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**')

  // 处理斜体 <i> 和 <em>
  text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*')
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*')

  // 处理下划线 <u> (Markdown 没有下划线，保留原文)
  text = text.replace(/<u>(.*?)<\/u>/gi, '$1')

  // 处理删除线 <s>, <del>, <strike>
  text = text.replace(/<s>(.*?)<\/s>/gi, '~~$1~~')
  text = text.replace(/<del>(.*?)<\/del>/gi, '~~$1~~')
  text = text.replace(/<strike>(.*?)<\/strike>/gi, '~~$1~~')

  // 处理行内代码 <code>
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`')

  // 处理链接 <a href="url">text</a>
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

  // 处理标记/高亮 <mark>
  text = text.replace(/<mark>(.*?)<\/mark>/gi, '==$1==')

  // 移除剩余的 HTML 标签
  text = text.replace(/<[^>]+>/g, '')

  // 处理 HTML 实体
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")

  return text
}

function blockToMarkdown(block: EditorJsBlock): string {
  const { type, data } = block

  switch (type) {
    case 'paragraph': {
      const text = htmlToMarkdown(data.text as string)
      return text ? `${text}\n` : ''
    }

    case 'header': {
      const level = (data.level as number) || 2
      const text = htmlToMarkdown(data.text as string)
      return text ? `${'#'.repeat(level)} ${text}\n` : ''
    }

    case 'list': {
      const style = data.style as string
      const items = data.items as Array<unknown> | undefined
      if (!items || items.length === 0) return ''
      return (
        items
          .map((item, i) => {
            if (typeof item === 'string') {
              return style === 'ordered' ? `${i + 1}. ${htmlToMarkdown(item)}` : `- ${htmlToMarkdown(item)}`
            }
            const obj = item as { content?: string; items?: Array<unknown> }
            return style === 'ordered' ? `${i + 1}. ${htmlToMarkdown(obj.content || '')}` : `- ${htmlToMarkdown(obj.content || '')}`
          })
          .join('\n') + '\n'
      )
    }

    case 'code': {
      const code = (data.code as string) || ''
      return code ? `\`\`\`\n${code}\n\`\`\`\n` : ''
    }

    case 'quote': {
      const text = htmlToMarkdown(data.text as string)
      const caption = htmlToMarkdown(data.caption as string)
      const lines = text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      return caption ? `${lines}\n> — ${caption}\n` : `${lines}\n`
    }

    case 'table': {
      const content = data.content as Array<Array<string>> | undefined
      if (!content || content.length === 0) return ''
      const withHeadings = data.withHeadings as boolean | undefined
      const rows = [...content]
      let result = ''

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        result += '| ' + row.map((cell) => htmlToMarkdown(cell) || ' ').join(' | ') + ' |\n'

        if (i === 0 && withHeadings) {
          result += '| ' + row.map(() => '---').join(' | ') + ' |\n'
        }
      }
      return result ? result + '\n' : ''
    }

    case 'delimiter':
      return '---\n'

    case 'image': {
      const file = data.file as { url?: string } | undefined
      const url = file?.url || (data.url as string) || ''
      const caption = htmlToMarkdown((data.caption as string) || '')
      return url ? `![${caption}](${url})\n` : ''
    }

    default:
      return ''
  }
}

export function editorJsToMarkdown(data: OutputData): string {
  if (!data.blocks || data.blocks.length === 0) return ''

  const parts: string[] = []

  for (const block of data.blocks) {
    const md = blockToMarkdown(block as EditorJsBlock)
    if (md) {
      parts.push(md)
    }
  }

  return parts.join('\n').trim()
}

/** Markdown 行内格式 → HTML（EditorJS 使用 HTML 标签表示富文本） */
function markdownInlineToHtml(md: string): string {
  let html = md
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>')
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>')
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
  return html
}

/** 将 Markdown 文本转换为 EditorJS OutputData，用于编辑器回显 */
export function markdownToEditorData(markdown: string): OutputData {
  if (!markdown) return { blocks: [], time: Date.now() }

  const lines = markdown.split('\n')
  const blocks: Array<{ type: string; data: Record<string, unknown> }> = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 空行跳过
    if (!trimmed) {
      i++
      continue
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'header',
        data: {
          level: headingMatch[1].length,
          text: markdownInlineToHtml(headingMatch[2])
        }
      })
      i++
      continue
    }

    // 无序列表
    if (/^[-*+]\s/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trim())) {
        items.push(markdownInlineToHtml(lines[i].trim().replace(/^[-*+]\s+/, '')))
        i++
      }
      blocks.push({ type: 'list', data: { style: 'unordered', items } })
      continue
    }

    // 有序列表
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(markdownInlineToHtml(lines[i].trim().replace(/^\d+\.\s+/, '')))
        i++
      }
      blocks.push({ type: 'list', data: { style: 'ordered', items } })
      continue
    }

    // 代码块
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束 ```
      blocks.push({ type: 'code', data: { code: codeLines.join('\n') } })
      continue
    }

    // 引用
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''))
        i++
      }
      blocks.push({
        type: 'quote',
        data: { text: markdownInlineToHtml(quoteLines.join('\n')), caption: '' }
      })
      continue
    }

    // 分隔线
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      blocks.push({ type: 'delimiter', data: {} })
      i++
      continue
    }

    // 表格
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableRows: Array<Array<string>> = []
      let withHeadings = false

      while (i < lines.length) {
        const rowLine = lines[i].trim()
        if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break

        const cells = rowLine
          .slice(1, -1)
          .split('|')
          .map((c) => markdownInlineToHtml(c.trim()))

        // 检查是否为分隔行
        if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
          withHeadings = tableRows.length === 1
          i++
          continue
        }

        tableRows.push(cells)
        i++
      }

      if (tableRows.length > 0) {
        blocks.push({
          type: 'table',
          data: { withHeadings, content: tableRows }
        })
      }
      continue
    }

    // 默认：段落
    blocks.push({
      type: 'paragraph',
      data: { text: markdownInlineToHtml(trimmed) }
    })
    i++
  }

  return { blocks, time: Date.now() } as OutputData
}

export function editorJsToPlainText(data: OutputData): string {
  if (!data.blocks || data.blocks.length === 0) return ''

  return data.blocks
    .map((block) => {
      const b = block as EditorJsBlock
      const d = b.data
      switch (b.type) {
        case 'paragraph':
          return htmlToMarkdown(d.text as string)
        case 'header':
          return htmlToMarkdown(d.text as string)
        case 'list':
          return ((d.items as Array<unknown>) || [])
            .map((item) =>
              typeof item === 'string' ? htmlToMarkdown(item) : htmlToMarkdown((item as { content?: string }).content || '')
            )
            .join(' ')
        case 'code':
          return d.code || ''
        case 'quote':
          return `${htmlToMarkdown(d.text as string)} ${htmlToMarkdown(d.caption as string)}`.trim()
        case 'table': {
          const content = (d.content as Array<Array<string>>) || []
          return content.flat().map(c => htmlToMarkdown(c)).join(' ')
        }
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}
