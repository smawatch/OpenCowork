import { useEffect, useRef, memo, useCallback, useState, useImperativeHandle, forwardRef } from 'react'
import EditorJS, { type OutputData, type ToolSettings, type BlockMutationEvent } from '@editorjs/editorjs'
import type { ToolConstructable, API as EditorAPI } from '@editorjs/editorjs'
import Header from '@editorjs/header'
import List from '@editorjs/list'
import CodeTool from '@editorjs/code'
import Quote from '@editorjs/quote'
import Table from '@editorjs/table'
import Underline from '@editorjs/underline'
import Marker from '@editorjs/marker'
import InlineCode from '@editorjs/inline-code'
import {
  Heading1,
  Heading2,
  Heading3,
  List as ListIcon,
  ListOrdered,
  Code,
  Quote as QuoteIcon,
  Table as TableIcon,
  Minus
} from 'lucide-react'
import './editorjs-theme.css'

// --------------- simple Bold / Italic inline tools ---------------

class BoldTool {
  static isInline = true
  static title = '加粗'
  static sanitize = { b: {} }

  render(): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ce-inline-tool'
    button.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14"><path fill="currentColor" d="M3.7 14V1.9h4.3c1.7 0 3 .4 3.8 1.2.8.8 1.2 1.9 1.2 3.3s-.4 2.5-1.3 3.4c-.8.8-2 1.3-3.5 1.3H6.1V14H3.7zm2.4-3.5h1.7c.8 0 1.4-.3 1.9-.8s.7-1.1.7-1.9-.3-1.4-.8-1.8-1.1-.7-1.8-.7H6.1v5.2z"/></svg>'
    return button
  }

  surround(_range: Range): void {
    document.execCommand('bold')
  }

  checkState(): boolean {
    return document.queryCommandState('bold')
  }
}

class ItalicTool {
  static isInline = true
  static title = '斜体'
  static sanitize = { i: {} }

  render(): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ce-inline-tool'
    button.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14"><path fill="currentColor" d="M5 14l1.5-7H4l.5-1.5h6.5L10.5 7H8l-1.5 7H5z"/></svg>'
    return button
  }

  surround(_range: Range): void {
    document.execCommand('italic')
  }

  checkState(): boolean {
    return document.queryCommandState('italic')
  }
}

// --------------- tools registry ---------------

const EDITOR_TOOLS: Record<string, ToolSettings> = {
  bold: { class: BoldTool as unknown as ToolConstructable },
  italic: { class: ItalicTool as unknown as ToolConstructable },
  underline: { class: Underline as unknown as ToolConstructable },
  marker: { class: Marker as unknown as ToolConstructable },
  inlineCode: { class: InlineCode as unknown as ToolConstructable },

  header: {
    class: Header as unknown as ToolConstructable,
    inlineToolbar: true,
    config: { placeholder: '标题', levels: [1, 2, 3], defaultLevel: 2 }
  },
  list: { class: List as unknown as ToolConstructable, inlineToolbar: true },
  code: { class: CodeTool as unknown as ToolConstructable },
  quote: {
    class: Quote as unknown as ToolConstructable,
    inlineToolbar: true,
    config: { quotePlaceholder: '引用内容', captionPlaceholder: '出处（可选）' }
  },
  table: { class: Table as unknown as ToolConstructable, inlineToolbar: true }
}

// --------------- i18n ---------------

const I18N_ZH = {
  toolNames: {
    Text: '文本',
    Paragraph: '段落',
    Heading: '标题',
    List: '列表',
    Code: '代码',
    Quote: '引用',
    Table: '表格',
    Underline: '下划线',
    Marker: '高亮',
    InlineCode: '行内代码'
  },
  tools: {
    header: {
      'Heading 1': '一级标题',
      'Heading 2': '二级标题',
      'Heading 3': '三级标题'
    },
    list: {
      Ordered: '有序列表',
      Unordered: '无序列表',
      'Start with': '起始编号',
      'Counter type': '计数类型'
    },
    quote: {
      'Enter a quote': '输入引用内容',
      'Enter a caption': '输入出处（可选）'
    },
    table: {
      'With headings': '带表头',
      'Without headings': '无表头',
      Stretch: '拉伸宽度',
      Collapse: '收起宽度',
      'Add column to left': '左侧添加列',
      'Add column to right': '右侧添加列',
      'Delete column': '删除列',
      'Add row above': '上方添加行',
      'Add row below': '下方添加行',
      'Delete row': '删除行',
      Heading: '表头'
    },
    code: {
      'Enter a code': '输入代码'
    },
    checklist: {
      Checklist: '待办清单'
    }
  },
  blockTunes: {
    delete: { Delete: '删除', 'Click to delete': '点击删除' },
    moveUp: { 'Move up': '上移' },
    moveDown: { 'Move down': '下移' },
    moveVertically: { 'Click to drag': '拖动排序' }
  },
  ui: {
    toolbar: {
      toolbox: { Add: '添加块', Filter: '搜索工具' }
    },
    inlineToolbar: {
      converter: { 'Convert to': '转换为' }
    },
    blockTunes: {
      toggler: { 'Click to tune': '点击调整' }
    },
    popover: {
      Filter: '搜索',
      'Nothing found': '未找到工具',
      'Convert to': '转换为'
    }
  }
}

const EMPTY_DATA: OutputData = { blocks: [], time: Date.now() }

// --------------- toolbar button config ---------------

interface ToolbarAction {
  label: string
  icon: React.ReactNode
  action: (api: EditorAPI) => void
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    label: 'H1',
    icon: <Heading1 className="size-4" />,
    action: (api) => api.blocks.insert('header', { level: 1, text: '' })
  },
  {
    label: 'H2',
    icon: <Heading2 className="size-4" />,
    action: (api) => api.blocks.insert('header', { level: 2, text: '' })
  },
  {
    label: 'H3',
    icon: <Heading3 className="size-4" />,
    action: (api) => api.blocks.insert('header', { level: 3, text: '' })
  },
  {
    label: '无序列表',
    icon: <ListIcon className="size-4" />,
    action: (api) => api.blocks.insert('list', { style: 'unordered', items: [''] })
  },
  {
    label: '有序列表',
    icon: <ListOrdered className="size-4" />,
    action: (api) => api.blocks.insert('list', { style: 'ordered', items: [''] })
  },
  {
    label: '代码块',
    icon: <Code className="size-4" />,
    action: (api) => api.blocks.insert('code', { code: '' })
  },
  {
    label: '引用',
    icon: <QuoteIcon className="size-4" />,
    action: (api) => api.blocks.insert('quote', { text: '', caption: '' })
  },
  {
    label: '表格',
    icon: <TableIcon className="size-4" />,
    action: (api) => {
      // 在当前位置插入 table，并在其后追加一个空 paragraph，
      // 防止用户完成表格编辑后光标被困、无法继续在表格下方输入正文
      const currentIndex = api.blocks.getCurrentBlockIndex()
      api.blocks.insert(
        'table',
        {
          withHeadings: true,
          content: [
            ['表头 1', '表头 2'],
            ['', '']
          ]
        },
        {},
        currentIndex + 1,
        true
      )
      api.blocks.insert(
        'paragraph',
        { text: '' },
        {},
        currentIndex + 2,
        true
      )
    }
  },
  {
    label: '分隔线',
    icon: <Minus className="size-4" />,
    action: (api) => api.blocks.insert('delimiter')
  }
]

export { TOOLBAR_ACTIONS }

// --------------- React component ---------------

export interface EditorJsRichTextHandle {
  getEditor: () => EditorJS | null
}

interface EditorJsRichTextProps {
  data?: OutputData
  onChange?: (data: OutputData) => void
  readOnly?: boolean
  placeholder?: string
  borderless?: boolean
  onEditorRef?: (editor: EditorJS | null) => void
}

function EditorJsRichTextInner(
  {
    data,
    onChange,
    readOnly = false,
    placeholder = '输入内容...',
    borderless = false,
    onEditorRef
  }: EditorJsRichTextProps,
  ref: React.ForwardedRef<EditorJsRichTextHandle>
): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorJS | null>(null)
  const [ready, setReady] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current
  }))

  const renderCountRef = useRef(0)
  useEffect(() => {
    renderCountRef.current += 1
    console.log('[EditorJS] component render #', renderCountRef.current)
  })

  const internalChangeRef = useRef(false)
  const trailingInsertingRef = useRef(false)

  const handleChange = useCallback(
    async (_api: EditorAPI, event: BlockMutationEvent | BlockMutationEvent[]) => {
      if (!editorRef.current || !onChangeRef.current) return
      // 跳过由我们内部追加 trailing paragraph 触发的 onChange，避免循环
      if (trailingInsertingRef.current) return

      const events = Array.isArray(event) ? event : [event]
      const types = events.map((e) => e.type)

      internalChangeRef.current = true
      const saved = await editorRef.current.save()
      const blocks = saved.blocks

      // 当新增/修改 block 后，若末尾是 table，自动追加一个空 paragraph，
      // 防止光标被困在表格中无法继续输入正文。
      // - block-changed: 用户在 table 单元格内编辑完成后触发
      // - block-added:   用户通过 "+" 弹出菜单或粘贴添加 table 时触发
      //                  （toolbar 按钮走 TOOLBAR_ACTIONS，已主动插入了 paragraph）
      const shouldCheck = types.includes('block-changed') || types.includes('block-added')
      if (shouldCheck && blocks.length > 0 && blocks[blocks.length - 1].type === 'table') {
        const currentCount = editorRef.current.blocks.getBlocksCount()
        // 再次确认末尾真的是 table（防御性检查）
        let lastBlockName: string | undefined
        try {
          lastBlockName = editorRef.current.blocks.getBlockByIndex(currentCount - 1)?.name
        } catch {
          /* ignore */
        }
        if (lastBlockName === 'table') {
          trailingInsertingRef.current = true
          try {
            editorRef.current.blocks.insert(
              'paragraph',
              { text: '' },
              {},
              currentCount,
              true
            )
          } catch {
            /* ignore */
          } finally {
            // 延迟释放，等待插入产生的 onChange 被跳过
            setTimeout(() => {
              trailingInsertingRef.current = false
            }, 100)
          }
        }
      }

      onChangeRef.current(saved)
    },
    []
  )

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = new EditorJS({
      holder: containerRef.current,
      tools: EDITOR_TOOLS,
      data: data || EMPTY_DATA,
      readOnly,
      placeholder,
      onChange: handleChange,
      minHeight: 0,
      i18n: { messages: I18N_ZH, direction: 'ltr' }
    })

    console.log('[EditorJS] created')
    editor.isReady.then(() => setReady(true))
    editorRef.current = editor
    onEditorRef?.(editor)

    return () => {
      console.log('[EditorJS] destroyed')
      editorRef.current?.destroy()
      editorRef.current = null
      onEditorRef?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 在 data 变化时加载内容（仅外部变更，如切换文档/进入编辑模式）
  useEffect(() => {
    if (!editorRef.current || !data) return
    if (internalChangeRef.current) {
      console.log('[EditorJS] data effect skipped (internal change)')
      return
    }
    console.log('[EditorJS] data effect calling render(), blocks:', data.blocks?.length)
    const render = async () => {
      await editorRef.current!.isReady
      await editorRef.current!.render(data)
    }
    render()
  }, [data])

  // 在 data effect 之后重置标记（effects 按声明顺序执行）
  useEffect(() => {
    internalChangeRef.current = false
  })

  const handleToolbarAction = useCallback((action: ToolbarAction) => {
    const editor = editorRef.current
    if (!editor) return
    // Editor.js instance exposes blocks API directly
    const api = editor as unknown as EditorAPI
    action.action(api)
  }, [])

  return (
    <div className={borderless ? 'editorjs-wrapper editorjs-borderless' : 'editorjs-wrapper rounded-md border bg-background'}>
      {!readOnly && !borderless && ready && (
        <div className="flex items-center gap-0.5 border-b px-2 py-1.5 flex-wrap">
          {TOOLBAR_ACTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              title={item.label}
              className="inline-flex items-center justify-center size-8 rounded hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                handleToolbarAction(item)
              }}
            >
              {item.icon}
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} className={borderless ? 'editorjs-container min-h-[400px]' : 'editorjs-container px-4 py-3 min-h-[250px]'} />
    </div>
  )
}

export const EditorJsRichText = memo(forwardRef(EditorJsRichTextInner))
