import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OutputData } from '@editorjs/editorjs'
import type EditorJS from '@editorjs/editorjs'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useAuthStore } from '@renderer/stores/auth-store'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import {
  listCollections,
  listChunks,
  deleteCollections,
  importFileToDataset,
  createFolder,
  downloadFile,
  listStoredFiles,
  type DatasetItem,
  type CollectionItem,
  type ChunkItem,
  type StoredFile,
  SYSTEM_TAG_CONFIG
} from '@renderer/lib/knowledge/kb-api-client'
import { goToKnowledgeList } from '@renderer/lib/knowledge-route'
import { EditorJsRichText } from '@renderer/components/editorjs/EditorJsRichText'
import { TOOLBAR_ACTIONS } from '@renderer/components/editorjs/EditorJsRichText'
import { editorJsToMarkdown, markdownToEditorData } from '@renderer/lib/editorjs/editorjs-to-markdown'
import {
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REHYPE_PLUGINS,
  createMarkdownComponents
} from '@renderer/lib/preview/viewers/markdown-components'

const MARKDOWN_COMPONENTS = createMarkdownComponents()

// --------------- helpers ---------------

function typeIcon(type: string): React.ReactNode {
  if (type === 'folder') return <FolderClosed className="size-4 text-amber-500" />
  return <FileText className="size-4 text-muted-foreground" />
}

function typeLabel(type: string): string {
  switch (type) {
    case 'virtual':
      return '手动录入'
    case 'link':
      return '网页链接'
    case 'folder':
      return '文件夹'
    default:
      return type
  }
}

// Draft storage key prefix
const DRAFT_STORAGE_PREFIX = 'kb-draft-'

interface DraftState {
  title: string
  content: string
  editorData: OutputData
  parentId?: string
}

// --------------- Tree ---------------

interface TreeNodeProps {
  item: CollectionItem
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (item: CollectionItem) => void
  selectedId: string | null
  onDelete?: (item: CollectionItem) => void
  onRename?: (item: CollectionItem) => void
}

function TreeNode({
  item,
  depth,
  expanded,
  onToggle,
  onSelect,
  selectedId,
  onDelete,
  onRename
}: TreeNodeProps): React.JSX.Element {
  const isFolder = item.type === 'folder'
  const isExpanded = expanded.has(item.id)
  const isSelected = selectedId === item.id
  const isDraft = item.id.startsWith('draft-')
  // 只有明确有训练任务且没有数据时才认为是解析中
  const isParsing = !isFolder && (item.trainingAmount ?? 0) > 0 && (item.dataAmount ?? 0) === 0

  return (
    <div>
      <button
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 text-left text-xs rounded transition-colors',
          isParsing ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (isParsing) {
            toast.info('文件正在切片解析中，请稍后查看...')
            return
          }
          if (isFolder) onToggle(item.id)
          onSelect(item)
        }}
      >
        {isFolder ? (
          isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="size-4 shrink-0 text-amber-500" />
        ) : isFolder ? (
          <FolderClosed className="size-4 shrink-0 text-amber-500" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate flex-1">
          {isDraft ? `📝 ${item.name}` : item.name}
        </span>
        {isParsing && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" style={{ backgroundColor: '#e6f7ff', color: '#1890ff' }}>
            <Loader2 className="size-2.5 animate-spin" />
            解析中
          </span>
        )}
        {isFolder && item.children && item.children.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60">{item.children.length}</span>
        )}
        {isFolder && item.dataAmount > 0 && (
          <span className="text-[10px] text-muted-foreground/60">{item.dataAmount}</span>
        )}
        {!isDraft && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            {onRename && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer p-0.5 hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRename(item)
                    }}
                  >
                    <Pencil className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>重命名</TooltipContent>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer p-0.5 hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(item)
                    }}
                  >
                    <Trash2 className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>删除</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </button>
      {isFolder && isExpanded && item.children && item.children.length > 0 && (
        <div className="group/tree">
          {item.children.map((child) => (
            <TreeNode
              key={child.id}
              item={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --------------- document toolbar ---------------

function DocToolbar({
  onAction
}: {
  onAction: (action: (typeof TOOLBAR_ACTIONS)[number]) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-px">
      {TOOLBAR_ACTIONS.map((item) => (
        <Tooltip key={item.label}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-slate-100 hover:text-slate-700 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                onAction(item)
              }}
            >
              {item.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {item.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

// --------------- main component ---------------

interface KnowledgeDetailProps {
  kbId: string
}

export function KnowledgeDetail({ kbId }: KnowledgeDetailProps): React.JSX.Element {
  const token = useAuthStore((s) => s.token)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // KB info (derive from allKbs or fetch)
  const [kbInfo, setKbInfo] = useState<DatasetItem | null>(null)
  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [loading, setLoading] = useState(true)

  // Tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [searchTree, setSearchTree] = useState('')

  // Content state
  const [chunks, setChunks] = useState<ChunkItem[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)

  // Stored files (for download)
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([])

  // Folder dialog
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  // Import dialog
  const [showImport, setShowImport] = useState(false)
  const [importTrainingType, setImportTrainingType] = useState('chunk')
  const [importFileBuffer, setImportFileBuffer] = useState<ArrayBuffer | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)

  // Draft mode state
  const [draftMode, setDraftMode] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftEditorData, setDraftEditorData] = useState<OutputData>({ blocks: [], time: Date.now() })
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const draftTitleRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<EditorJS | null>(null)
  const handleEditorRef = useCallback((ed: EditorJS | null) => { docRef.current = ed }, [])

  // Edit mode for published documents
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editEditorData, setEditEditorData] = useState<OutputData>({ blocks: [], time: Date.now() })
  const [editDirty, setEditDirty] = useState(false)

  // Delete confirmation dialog
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<CollectionItem | null>(null)

  // Leave confirmation dialog
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  // ==================== data fetching ====================

  const loadedRef = useRef<Set<string>>(new Set())

  const fetchCollections = useCallback(async (datasetId: string) => {
    setLoading(true)
    try {
      const r = await listCollections(ipcClient, datasetId)
      if (r.success) setCollections(r.data ?? [])
    } catch {
      /* silent */
    }
    setLoading(false)
  }, [])

  const fetchChildren = useCallback(
    async (datasetId: string, parentId: string) => {
      try {
        const r = await listCollections(ipcClient, datasetId, parentId)
        if (r.success) {
          const fresh = r.data ?? []
          setCollections((prev) => {
            // Remove all previous children of this parent, then add fresh ones
            const withoutOld = prev.filter((c) => c.parentId !== parentId)
            return [...withoutOld, ...fresh]
          })
          loadedRef.current.add(parentId)
        }
      } catch {
        /* silent */
      }
    },
    []
  )

  useEffect(() => {
    fetchCollections(kbId)
  }, [kbId, fetchCollections])

  // Check if any item is currently parsing
  const hasParsing = useMemo(
    () => collections.some((c) => (c.trainingAmount ?? 0) > 0),
    [collections]
  )

  // Poll for training status updates when items are being parsed
  // 使用独立状态，不干扰主列表渲染
  useEffect(() => {
    if (!hasParsing) return

    let cancelled = false

    const poll = async () => {
      try {
        const r = await listCollections(ipcClient, kbId)
        if (cancelled || !r.success) return

        // 只更新训练状态，不替换整个列表
        setCollections((prev) =>
          prev.map((c) => {
            const fresh = r.data?.find((f) => f.id === c.id)
            if (!fresh) return c
            return {
              ...c,
              trainingAmount: fresh.trainingAmount,
              dataAmount: fresh.dataAmount
            }
          })
        )

        // 更新已展开文件夹的子项
        for (const parentId of loadedRef.current) {
          if (!parentId) continue
          const childR = await listCollections(ipcClient, kbId, parentId)
          if (cancelled || !childR.success) continue
          setCollections((prev) => {
            const freshChildren = childR.data ?? []
            const withoutOld = prev.filter((c) => c.parentId !== parentId)
            return [...withoutOld, ...freshChildren]
          })
        }
      } catch {
        // silent
      }
    }

    const interval = setInterval(poll, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [hasParsing, kbId])

  // Fetch stored files for download
  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const r = await listStoredFiles(ipcClient, kbId)
        if (r.success) setStoredFiles(r.data ?? [])
      } catch {
        /* silent */
      }
    }
    fetchFiles()
  }, [kbId])

  // Check if current selected item has a stored file
  const currentStoredFile = useMemo(() => {
    if (!selectedItem || selectedItem.type === 'folder') return null
    return storedFiles.find((f) => f.collectionId === selectedItem.id) || null
  }, [selectedItem, storedFiles])

  // Download handler — works for both uploaded files and new documents
  const handleDownloadFile = useCallback(async () => {
    if (!selectedItem) return

    // 上传文件：通过 storedFile 下载原始文件
    if (currentStoredFile) {
      try {
        const r = await downloadFile(ipcClient, {
          datasetId: kbId,
          collectionId: selectedItem.id,
          fileName: currentStoredFile.fileName
        })
        if (!r.success) {
          toast.error(r.error || '下载失败')
        } else {
          toast.success('文件已保存')
        }
      } catch {
        toast.error('下载失败')
      }
      return
    }

    // 新建文档：生成 .md 文件并弹出保存对话框
    try {
      const result = (await ipcClient.invoke(IPC.FS_SELECT_SAVE_FILE, {
        defaultPath: `${selectedItem.name}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })) as { canceled?: boolean; filePath?: string }
      if (result.canceled || !result.filePath) return
      const chunks = await listChunks(ipcClient, selectedItem.id)
      const content = chunks.success && chunks.data
        ? chunks.data.map(c => c.content || '').join('\n\n')
        : ''
      await ipcClient.invoke(IPC.FS_WRITE_FILE, { filePath: result.filePath, content } as Record<string, unknown>)
      toast.success('文件已保存')
    } catch {
      toast.error('导出失败')
    }
  }, [kbId, selectedItem, currentStoredFile])

  // Fetch KB info from both personal and enterprise datasets
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const { listDatasets } = await import('@renderer/lib/knowledge/kb-api-client')
        // Try personal datasets first
        if (token) {
          try {
            const r = await listDatasets(ipcClient)
            if (r.success) {
              const found = (r.data ?? []).find((d) => d.id === kbId)
              if (found) {
                // Ensure systemTag is set (API may not return it)
                setKbInfo({ ...found, systemTag: found.systemTag || '个人' })
                return
              }
            }
          } catch {
            /* silent */
          }
        }
        // Try enterprise datasets
        try {
          const r = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_DATASETS)) as {
            success: boolean
            data?: DatasetItem[]
          }
          if (r.success) {
            const found = (r.data ?? []).find((d) => d.id === kbId)
            if (found) {
              // Enterprise datasets are read-only
              setKbInfo({ ...found, systemTag: found.systemTag || '企业' })
            }
          }
        } catch {
          /* silent */
        }
      } catch {
        /* silent */
      }
    }
    fetchInfo()
  }, [kbId, token])

  // Determine if this KB is read-only (enterprise or explicitly marked as read-only)
  const isReadOnly = useMemo(() => {
    if (!kbInfo?.systemTag) return false
    return kbInfo.systemTag === '企业' || kbInfo.systemTag === '只读'
  }, [kbInfo])

  // ==================== tree structure ====================

  const folderTree = useMemo(() => {
    // Build a tree from flat list using parentId
    const nodeMap = new Map<string, CollectionItem>()
    const roots: CollectionItem[] = []

    // First pass: clone items into map
    for (const c of collections) {
      nodeMap.set(c.id, { ...c, children: [] })
    }

    // Second pass: attach children to parents
    for (const c of nodeMap.values()) {
      const pid = c.parentId || null
      if (pid && nodeMap.has(pid)) {
        nodeMap.get(pid)!.children!.push(c)
      } else {
        roots.push(c)
      }
    }

    // Add draft item if in draft mode
    if (draftMode && draftId) {
      const draftItem: CollectionItem = {
        id: draftId,
        name: draftTitle || '未命名文档',
        type: 'virtual',
        trainingType: 'chunk',
        dataAmount: 0,
        tags: [],
        updateTime: new Date().toISOString(),
        parentId: currentFolderId || undefined
      }

      if (currentFolderId) {
        // Add to parent folder
        for (const c of nodeMap.values()) {
          if (c.id === currentFolderId) {
            c.children = c.children || []
            c.children.push(draftItem)
            break
          }
        }
      } else {
        // Add to root
        roots.push(draftItem)
      }
    }

    // Sort: folders first, then by name
    const sortNode = (items: CollectionItem[]) => {
      items.sort((a, b) => {
        const aIsFolder = a.type === 'folder' ? 0 : 1
        const bIsFolder = b.type === 'folder' ? 0 : 1
        const aIsDraft = a.id.startsWith('draft-') ? 1 : 0
        const bIsDraft = b.id.startsWith('draft-') ? 1 : 0
        if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder
        if (aIsDraft !== bIsDraft) return bIsDraft - aIsDraft // Drafts at top
        return a.name.localeCompare(b.name, 'zh-Hans')
      })
      for (const item of items) {
        if (item.children && item.children.length > 0) sortNode(item.children)
      }
    }
    sortNode(roots)

    if (!searchTree.trim()) return roots
    // Filter tree by search
    const filterTree = (items: CollectionItem[]): CollectionItem[] => {
      const result: CollectionItem[] = []
      for (const item of items) {
        const match = item.name.toLowerCase().includes(searchTree.trim().toLowerCase())
        const filteredChildren = item.children ? filterTree(item.children) : []
        if (match || filteredChildren.length > 0) {
          result.push({ ...item, children: filteredChildren })
        }
      }
      return result
    }
    return filterTree(roots)
  }, [collections, searchTree, draftMode, draftId, draftTitle, currentFolderId])

  // Keep selectedItem in sync when tree changes (e.g. after lazy-load)
  useEffect(() => {
    if (!selectedId) return
    const find = (items: CollectionItem[]): CollectionItem | null => {
      for (const item of items) {
        if (item.id === selectedId) return item
        if (item.children) {
          const found = find(item.children)
          if (found) return found
        }
      }
      return null
    }
    const current = find(folderTree)
    if (current) setSelectedItem(current)
  }, [folderTree, selectedId])

  // ==================== actions ====================

  const handleSelectDoc = useCallback(async (item: CollectionItem) => {
    // Check if we have unsaved changes
    if (draftDirty || editDirty) {
      setPendingAction(() => () => {
        setSelectedId(item.id)
        setSelectedItem(item)
        if (item.type === 'folder') {
          setCurrentFolderId(item.id)
          setChunks([])
          return
        }
        setChunksLoading(true)
        listChunks(ipcClient, item.id).then((r) => {
          if (r.success) setChunks(r.data ?? [])
          setChunksLoading(false)
        }).catch(() => setChunksLoading(false))
      })
      setShowLeaveConfirm(true)
      return
    }

    setSelectedId(item.id)
    setSelectedItem(item)
    if (item.type === 'folder') {
      // Select this folder as the current folder for uploads
      setCurrentFolderId(item.id)
      setChunks([])
      return
    }
    setChunksLoading(true)
    try {
      const r = await listChunks(ipcClient, item.id)
      if (r.success) setChunks(r.data ?? [])
    } catch {
      /* silent */
    }
    setChunksLoading(false)
  }, [draftDirty, editDirty])

  const handleDeleteItem = useCallback(async (item: CollectionItem) => {
    // 计算子项数量
    const countChildren = (parentId: string): { docs: number; folders: number } => {
      let docs = 0
      let folders = 0
      for (const c of collections) {
        if (c.parentId === parentId) {
          if (c.type === 'folder') {
            folders++
            const sub = countChildren(c.id)
            docs += sub.docs
            folders += sub.folders
          } else {
            docs++
          }
        }
      }
      return { docs, folders }
    }

    if (item.type === 'folder') {
      const childCounts = countChildren(item.id)
      // 注入子项计数供弹窗展示
      setDeleteConfirmItem({
        ...item,
        dataAmount: childCounts.docs,
        tags: [`${childCounts.folders} 个子目录`]
      })
    } else {
      setDeleteConfirmItem(item)
    }
  }, [collections])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmItem) return
    const item = deleteConfirmItem
    setDeleteConfirmItem(null)

    try {
      const r = await deleteCollections(ipcClient, { datasetId: kbId, collectionIds: [item.id] })
      if (!r.success) {
        toast.error(r.error || '删除失败')
        return
      }
      toast.success('已删除')
      if (selectedId === item.id) {
        setSelectedId(null)
        setSelectedItem(null)
        setChunks([])
      }
      if (item.parentId && item.parentId.trim()) {
        loadedRef.current.delete(item.parentId)
        fetchChildren(kbId, item.parentId)
      } else {
        fetchCollections(kbId)
      }
    } catch {
      toast.error('删除失败')
    }
  }, [deleteConfirmItem, kbId, selectedId, fetchCollections, fetchChildren])

  const handleCreateFolder = useCallback(async () => {
    if (!folderName.trim()) return
    setCreatingFolder(true)
    try {
      const r = await createFolder(ipcClient, {
        datasetId: kbId,
        name: folderName.trim(),
        parentId: currentFolderId || undefined
      })
      if (!r.success) {
        toast.error(r.error || '创建失败')
        return
      }
      toast.success('目录已创建')
      setShowCreateFolder(false)
      setFolderName('')
      if (currentFolderId) {
        loadedRef.current.delete(currentFolderId)
        fetchChildren(kbId, currentFolderId)
      } else {
        fetchCollections(kbId)
      }
    } catch {
      /* silent */
    }
    setCreatingFolder(false)
  }, [kbId, folderName, currentFolderId, fetchCollections, fetchChildren])

  const handleImportFile = useCallback(async () => {
    if (!importFileBuffer) return
    setImporting(true)
    try {
      const r = await importFileToDataset(ipcClient, {
        datasetId: kbId,
        fileName: importFileName,
        fileBuffer: importFileBuffer,
        trainingType: importTrainingType,
        parentId: currentFolderId || undefined
      })
      if (!r.success) {
        toast.error(r.error || '导入失败')
        return
      }
      toast.success('导入成功')
      setShowImport(false)
      setImportFileBuffer(null)
      setImportFileName('')
      if (currentFolderId) {
        loadedRef.current.delete(currentFolderId)
        fetchChildren(kbId, currentFolderId)
      } else {
        fetchCollections(kbId)
      }
    } catch {
      /* silent */
    }
    setImporting(false)
  }, [
    kbId,
    importFileBuffer,
    importFileName,
    importTrainingType,
    currentFolderId,
    fetchCollections,
    fetchChildren
  ])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImportFileBuffer(reader.result as ArrayBuffer)
      setImportFileName(file.name)
    }
    reader.readAsArrayBuffer(file)
  }, [])

  // ==================== draft actions ====================

  const generateUniqueName = useCallback((baseName: string): string => {
    const existingNames = new Set(collections.map(c => c.name))
    if (!existingNames.has(baseName)) return baseName

    let counter = 1
    while (existingNames.has(`${baseName}(${counter})`)) {
      counter++
    }
    return `${baseName}(${counter})`
  }, [collections])

  const handleCreateDraft = useCallback(() => {
    const draftName = generateUniqueName('未命名文档')
    const newDraftId = `draft-${Date.now()}`

    setDraftId(newDraftId)
    setDraftTitle(draftName)
    setDraftContent('')
    setDraftEditorData({ blocks: [], time: Date.now() })
    setDraftDirty(true)
    setDraftMode(true)
    setSelectedId(newDraftId)
    setSelectedItem({
      id: newDraftId,
      name: draftName,
      type: 'virtual',
      trainingType: 'chunk',
      dataAmount: 0,
      tags: [],
      updateTime: new Date().toISOString(),
      parentId: currentFolderId || undefined
    })

    // Focus title input after render
    setTimeout(() => {
      draftTitleRef.current?.focus()
      draftTitleRef.current?.select()
    }, 100)
  }, [generateUniqueName, currentFolderId])

  const handlePublishDraft = useCallback(async () => {
    if (!draftTitle.trim() || !draftContent.trim()) {
      toast.error('请填写标题和内容')
      return
    }

    setDraftSaving(true)
    try {
      // 将 Markdown 编码为 .md 文件，通过文件导入接口上传
      const encoder = new TextEncoder()
      const buffer = encoder.encode(draftContent).buffer as ArrayBuffer

      const importResult = await importFileToDataset(ipcClient, {
        datasetId: kbId,
        fileName: `${draftTitle.trim()}.md`,
        fileBuffer: buffer,
        trainingType: 'chunk',
        parentId: currentFolderId || undefined
      })

      if (!importResult.success) {
        toast.error(importResult.error || '发布失败')
        return
      }

      toast.success('发布成功')
      setDraftMode(false)
      setDraftId(null)
      setDraftTitle('')
      setDraftContent('')
      setDraftEditorData({ blocks: [], time: Date.now() })
      setDraftDirty(false)

      // 清理 localStorage 中的草稿数据
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)

      const newDocId = importResult.data?.collectionId

      // Refresh collections and select the new document
      let newCollections: CollectionItem[] = []
      if (currentFolderId) {
        loadedRef.current.delete(currentFolderId)
        const cr = await listCollections(ipcClient, kbId, currentFolderId)
        if (cr.success) {
          newCollections = (cr.data ?? []).map((c) =>
            c.id === newDocId ? { ...c, name: draftTitle.trim() } : c
          )
          setCollections((prev) => {
            const withoutOld = prev.filter((c) => c.parentId !== currentFolderId)
            return [...withoutOld, ...newCollections]
          })
        }
      } else {
        const cr = await listCollections(ipcClient, kbId)
        if (cr.success) {
          newCollections = (cr.data ?? []).map((c) =>
            c.id === newDocId ? { ...c, name: draftTitle.trim() } : c
          )
          setCollections(newCollections)
        }
      }

      // Select the newly created document
      const newDoc = newCollections.find((c) => c.id === newDocId)
      if (newDoc) {
        newDoc.name = draftTitle.trim()
        setSelectedId(newDoc.id)
        setSelectedItem(newDoc)
        setChunksLoading(true)
        listChunks(ipcClient, newDoc.id).then((r) => {
          if (r.success) setChunks(r.data ?? [])
          setChunksLoading(false)
        }).catch(() => setChunksLoading(false))
      }
    } catch {
      toast.error('发布失败')
    }
    setDraftSaving(false)
  }, [kbId, draftTitle, draftContent, currentFolderId, fetchCollections, fetchChildren])

  const handleDiscardDraft = useCallback(() => {
    setDraftMode(false)
    setDraftId(null)
    setDraftTitle('')
    setDraftContent('')
    setDraftEditorData({ blocks: [], time: Date.now() })
    setDraftDirty(false)
    setSelectedId(null)
    setSelectedItem(null)

    // 清理 localStorage 中的草稿数据
    localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)

    toast.success('草稿已放弃')
  }, [kbId])

  // Auto-save draft — 纯静默，零 setState，不触发任何渲染
  const lastSavedRef = useRef('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!draftMode) return

    const snapshot = JSON.stringify({ title: draftTitle, content: draftContent, editorData: draftEditorData })
    if (snapshot === lastSavedRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      console.log('[KnowledgeDetail] auto-save to localStorage')
      const data: DraftState = {
        title: draftTitle,
        content: draftContent,
        editorData: draftEditorData,
        parentId: currentFolderId || undefined
      }
      localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${kbId}`, JSON.stringify(data))
      lastSavedRef.current = snapshot
    }, 2000)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [draftMode, draftTitle, draftContent, draftEditorData])

  // Load draft on mount
  useEffect(() => {
    const saved = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
    if (saved) {
      try {
        const data: DraftState = JSON.parse(saved)
        if (data.title && data.content) {
          setDraftTitle(data.title)
          setDraftContent(data.content)
          setDraftEditorData(data.editorData || { blocks: [], time: Date.now() })
          setDraftDirty(false)
          setDraftMode(true)
          setDraftId(`draft-${Date.now()}`)
          setSelectedId(`draft-${Date.now()}`)
        }
      } catch {
        localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
      }
    }
  }, [kbId])

  // ==================== edit mode actions ====================

  const handleEnterEditMode = useCallback(() => {
    if (!selectedItem || selectedItem.type === 'folder') return

    // Load current content and convert markdown to EditorJS format
    const currentChunk = chunks[0]
    const content = currentChunk?.content || ''
    setEditTitle(selectedItem.name.replace(/\.md$/i, ''))
    setEditContent(content)
    setEditEditorData(markdownToEditorData(content))
    setEditMode(true)
  }, [selectedItem, chunks])

  const handleExitEditMode = useCallback(() => {
    if (editDirty) {
      setPendingAction(() => () => {
        setEditMode(false)
        setEditDirty(false)
      })
      setShowLeaveConfirm(true)
      return
    }
    setEditMode(false)
    setEditDirty(false)
  }, [editDirty])

  const handleSaveEdit = useCallback(async () => {
    if (!selectedItem || !editTitle.trim() || !editContent.trim()) {
      toast.error('请填写标题和内容')
      return
    }

    try {
      // 将 Markdown 内容转为文件，通过导入接口上传
      const encoder = new TextEncoder()
      const buffer = encoder.encode(editContent).buffer as ArrayBuffer

      const importResult = await importFileToDataset(ipcClient, {
        datasetId: kbId,
        fileName: `${editTitle.trim().replace(/\.md$/i, '')}.md`,
        fileBuffer: buffer,
        trainingType: 'chunk',
        parentId: selectedItem.parentId || undefined
      })

      if (!importResult.success) {
        toast.error(importResult.error || '保存失败')
        return
      }

      const newCollectionId = importResult.data?.collectionId
      const oldParentId = selectedItem.parentId

      // 删除旧文档
      await deleteCollections(ipcClient, {
        datasetId: kbId,
        collectionIds: [selectedItem.id]
      })

      toast.success('保存成功')
      setEditMode(false)
      setEditDirty(false)

      // 刷新列表并选中新文档
      let refreshed: CollectionItem[] = []
      if (oldParentId) {
        loadedRef.current.delete(oldParentId)
        const cr = await listCollections(ipcClient, kbId, oldParentId)
        if (cr.success) {
          refreshed = (cr.data ?? []).map((c) =>
            c.id === newCollectionId ? { ...c, name: `${editTitle.trim().replace(/\.md$/i, '')}.md` } : c
          )
          setCollections((prev) => {
            const withoutOld = prev.filter((c) => c.parentId !== oldParentId && c.id !== selectedItem.id)
            return [...withoutOld, ...refreshed]
          })
        }
      } else {
        const cr = await listCollections(ipcClient, kbId)
        if (cr.success) {
          refreshed = (cr.data ?? []).map((c) =>
            c.id === newCollectionId ? { ...c, name: `${editTitle.trim().replace(/\.md$/i, '')}.md` } : c
          )
          setCollections(refreshed)
        }
      }

      // 选中新文档
      const newDoc = refreshed.find((c) => c.id === newCollectionId)
      if (newDoc) {
        setSelectedId(newDoc.id)
        setSelectedItem(newDoc)
        setChunksLoading(true)
        listChunks(ipcClient, newDoc.id).then((r) => {
          if (r.success) setChunks(r.data ?? [])
          setChunksLoading(false)
        }).catch(() => setChunksLoading(false))
      } else {
        setSelectedId(null)
        setSelectedItem(null)
        setChunks([])
      }
    } catch {
      toast.error('保存失败')
    }
  }, [kbId, selectedItem, editTitle, editContent, fetchCollections, fetchChildren])

  // ==================== stats ====================

  const sysCfg = kbInfo?.systemTag ? SYSTEM_TAG_CONFIG[kbInfo.systemTag] : null

  // ==================== leave protection ====================

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false)
    if (pendingAction) {
      pendingAction()
      setPendingAction(null)
    }
  }, [pendingAction])

  const handleCancelLeave = useCallback(() => {
    setShowLeaveConfirm(false)
    setPendingAction(null)
  }, [])

  const handleGoToRoot = useCallback(() => {
    setCurrentFolderId(null)
    setSelectedId(null)
    setSelectedItem(null)
    setChunks([])
  }, [])

  const handleDocToolbar = useCallback((action: (typeof TOOLBAR_ACTIONS)[number]) => {
    const editor = docRef.current
    if (!editor) return
    const api = editor as unknown as import('@editorjs/editorjs').API
    action.action(api)
  }, [])

  const handleDraftChange = useCallback((data: OutputData) => {
    setDraftEditorData(data)
    setDraftContent(editorJsToMarkdown(data))
    setDraftDirty(true)
  }, [])

  const handleEditChange = useCallback((data: OutputData) => {
    setEditEditorData(data)
    setEditContent(editorJsToMarkdown(data))
    setEditDirty(true)
  }, [])

  // ==================== JSX ====================

  return (
    <div className="flex h-full min-h-0 flex-col bg-background overflow-hidden">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />

      {/* ---- Header ---- */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={goToKnowledgeList}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            <BookOpen className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                className="text-base font-semibold truncate hover:text-primary transition-colors cursor-pointer"
                onClick={handleGoToRoot}
                title="点击回到根目录"
              >
                {kbInfo?.name || kbId}
              </button>
              {sysCfg && (
                <span
                  className="inline-flex items-center shrink-0 rounded-full px-2 h-[22px] text-[11px] font-medium leading-none"
                  style={{ backgroundColor: sysCfg.bg, color: sysCfg.color }}
                >
                  {kbInfo?.systemTag}
                </span>
              )}
            </div>
            {kbInfo?.intro && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{kbInfo.intro}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!isReadOnly && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    setImportFileBuffer(null)
                    setImportFileName('')
                    setShowImport(true)
                  }}
                >
                  <FileText className="size-3 mr-1" />
                  导入
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    setFolderName('')
                    setShowCreateFolder(true)
                  }}
                >
                  <FolderPlus className="size-3 mr-1" />
                  新建目录
                </Button>
                <Button
                  size="sm"
                  className="text-xs h-7"
                  onClick={handleCreateDraft}
                >
                  <Plus className="size-3 mr-1" />
                  新建文档
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => fetchCollections(kbId)}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Body ---- */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-[260px] border-r flex flex-col shrink-0">
          {/* Search */}
          <div className="px-3 py-2.5 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs"
                placeholder="搜索文档..."
                value={searchTree}
                onChange={(e) => setSearchTree(e.target.value)}
              />
            </div>
          </div>
          {/* Tree */}
          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {/* 根目录入口 */}
            {!isReadOnly && (
              <button
                className={cn(
                  'flex items-center gap-1.5 w-full px-2 py-1.5 text-left text-xs rounded transition-colors hover:bg-accent/50',
                  !currentFolderId && !selectedId && 'bg-accent text-accent-foreground font-medium'
                )}
                onClick={handleGoToRoot}
              >
                <span className="size-4 shrink-0 flex items-center justify-center text-amber-500">
                  <BookOpen className="size-3.5" />
                </span>
                <span className="truncate flex-1">根目录</span>
              </button>
            )}
            {loading ? (
              <div className="space-y-1 px-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full rounded" />
                ))}
              </div>
            ) : folderTree.length === 0 && !draftMode ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无内容</div>
            ) : (
              folderTree.map((item) => (
                <div key={item.id} className="group">
                  <TreeNode
                    item={item}
                    depth={0}
                    expanded={expanded}
                    onToggle={(id) => {
                      const isOpening = !expanded.has(id)
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (isOpening) {
                          next.add(id)
                        } else {
                          next.delete(id)
                        }
                        return next
                      })
                      if (isOpening && !loadedRef.current.has(id)) {
                        console.log(`[KnowledgeDetail] 展开文件夹，加载子级: ${id}`)
                        fetchChildren(kbId, id)
                      }
                    }}
                    onSelect={handleSelectDoc}
                    selectedId={selectedId}
                    onDelete={isReadOnly ? undefined : handleDeleteItem}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col" style={{ background: '#f8fafc' }}>
          {/* Draft mode - immersive editor */}
          {draftMode ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 flex flex-col min-h-0 mx-auto w-full max-w-[900px]">
                <div className="flex flex-col flex-1 min-h-0 mt-6 mb-8 rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  {/* Sticky toolbar */}
                  <div className="shrink-0 sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-10 py-2.5 flex items-center gap-3">
                    <DocToolbar onAction={handleDocToolbar} />
                    <div className="flex-1" />
                    <div className="flex items-center gap-2.5">
                      {!draftDirty && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Check className="size-3" />
                          已保存
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 text-slate-500 hover:text-slate-700"
                        onClick={handleDiscardDraft}
                      >
                        放弃
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs h-7 bg-slate-800 hover:bg-slate-700 text-white"
                        onClick={handlePublishDraft}
                        disabled={draftSaving || !draftTitle.trim() || !draftContent.trim()}
                      >
                        {draftSaving && <Loader2 className="size-3 mr-1 animate-spin" />}
                        发布
                      </Button>
                    </div>
                  </div>

                  {/* Scrollable content */}
                  <div className="flex-1 overflow-y-auto px-10 pt-8 pb-24">
                    {/* Document info */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-slate-400">📄 草稿</span>
                      {!draftDirty && (
                        <>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs text-slate-400">已自动保存</span>
                        </>
                      )}
                    </div>

                    {/* Title */}
                    <input
                      ref={draftTitleRef}
                      type="text"
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value)
                        setDraftDirty(true)
                      }}
                      placeholder="输入文档标题..."
                      className="w-full border-0 outline-none bg-transparent mb-8 focus:ring-0 placeholder:text-slate-200"
                      style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2, color: '#1f2329' }}
                    />

                    {/* Editor — borderless document mode */}
                    <EditorJsRichText
                      key="draft-editor"
                      placeholder="开始创作..."
                      data={draftEditorData}
                      borderless
                      onEditorRef={handleEditorRef}
                      onChange={handleDraftChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : !selectedItem ? (
            /* ---- Root overview ---- */
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-[900px] mx-auto p-8">
                <div className="flex items-center gap-2 mb-6">
                  <BookOpen className="size-4 text-slate-400" />
                  <span className="text-xs text-slate-400">
                    {currentFolderId ? '当前目录' : '知识库根目录'}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="text-2xl font-bold text-primary">
                      {collections.filter(c => c.type !== 'folder').length}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">文档数量</div>
                  </div>
                  <div className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="text-2xl font-bold text-primary">
                      {collections.filter(c => c.type === 'folder').length}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">文件夹数量</div>
                  </div>
                  <div className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="text-2xl font-bold text-primary">
                      {collections.reduce((s, c) => s + (c.dataAmount || 0), 0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">数据总量</div>
                  </div>
                </div>

                {/* Recent updates */}
                <h3 className="text-sm font-semibold mb-3">最近更新</h3>
                {collections.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    {isReadOnly ? '暂无内容' : '暂无内容，点击「新建文档」或「导入」开始'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[...collections]
                      .sort((a, b) => new Date(b.updateTime || '').getTime() - new Date(a.updateTime || '').getTime())
                      .slice(0, 10)
                      .map((c) => (
                        <button
                          key={c.id}
                          className="flex items-center gap-3 w-full px-3 py-2 text-left rounded-md hover:bg-accent/50 transition-colors"
                          onClick={() => handleSelectDoc(c)}
                        >
                          {typeIcon(c.type)}
                          <span className="text-sm truncate flex-1">{c.name}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {c.type === 'folder' ? '文件夹' : c.dataAmount > 0 ? `${c.dataAmount} 条数据` : '解析中'}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ---- Folder / Document content ---- */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 flex flex-col min-h-0 mx-auto w-full max-w-[900px]">
                <div className="flex flex-col flex-1 min-h-0 mt-6 mb-8 rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  {editMode ? (
                    <>
                      {/* Edit sticky toolbar */}
                      <div className="shrink-0 sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-10 py-2.5 flex items-center gap-3">
                        <DocToolbar onAction={handleDocToolbar} />
                        <div className="flex-1" />
                        <div className="flex items-center gap-2.5">
                          {!editDirty && (
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Check className="size-3" />
                              已保存
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7 text-slate-500 hover:text-slate-700"
                            onClick={handleExitEditMode}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            className="text-xs h-7 bg-slate-800 hover:bg-slate-700 text-white"
                            onClick={handleSaveEdit}
                            disabled={!editTitle.trim() || !editContent.trim()}
                          >
                            保存
                          </Button>
                        </div>
                      </div>

                      {/* Edit content */}
                      <div className="flex-1 overflow-y-auto px-10 pt-8 pb-24">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => {
                            setEditTitle(e.target.value)
                            setEditDirty(true)
                          }}
                          placeholder="输入文档标题..."
                          className="w-full border-0 outline-none bg-transparent mb-8 focus:ring-0 placeholder:text-slate-200"
                          style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2, color: '#1f2329' }}
                        />
                        <EditorJsRichText
                          key={`edit-editor-${selectedItem?.id ?? 'none'}`}
                          placeholder="开始编辑..."
                          data={editEditorData}
                          borderless
                          onEditorRef={handleEditorRef}
                          onChange={handleEditChange}
                        />
                      </div>
                    </>
                  ) : (
                /* View mode */
                <>
                  {/* Document header bar */}
                  <div className="shrink-0 sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-10 py-2.5 flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {selectedItem.type === 'folder' ? '📁' : '📄'} {typeLabel(selectedItem.type)}
                    </span>
                    <div className="flex-1" />
                    {!isReadOnly && selectedItem.type !== 'folder' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 text-slate-500 hover:text-slate-700"
                            onClick={handleDownloadFile}
                          >
                            <Download className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>下载原始文件</TooltipContent>
                      </Tooltip>
                    )}
                    {!isReadOnly && selectedItem.type !== 'folder' && selectedItem.name.endsWith('.md') && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 text-slate-500 hover:text-slate-700"
                            onClick={handleEnterEditMode}
                          >
                            <Edit3 className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>编辑文档</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* View content */}
                  <div className="flex-1 overflow-y-auto px-10 pt-8 pb-24">
                    <h1
                      className="mb-8"
                      style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2, color: '#1f2329' }}
                    >
                      {selectedItem.name}
                    </h1>

                  {selectedItem.type === 'folder' ? (
                    /* Folder overview */
                    selectedItem.children && selectedItem.children.length > 0 ? (
                      <div className="space-y-1">
                        {selectedItem.children.map((child) => (
                          <button
                            key={child.id}
                            className="flex items-center gap-3 w-full px-3 py-2 text-left rounded-md hover:bg-accent/50 transition-colors"
                            onClick={() => handleSelectDoc(child)}
                          >
                            {typeIcon(child.type)}
                            <span className="text-sm truncate flex-1">{child.name}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {child.type === 'folder' ? '文件夹' : `${child.dataAmount} 条数据`}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground py-16 text-center">
                        {isReadOnly ? '空目录' : '空目录，点击「新建文档」或「导入」添加内容'}
                      </div>
                    )
                  ) : chunksLoading ? (
                    <div className="flex justify-center py-16">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : chunks.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-16 text-center">暂无内容</div>
                  ) : (
                    <div className="space-y-6">
                      {chunks.map((chunk) => (
                        <div key={chunk.id} className="border-b border-slate-100 pb-6 last:border-0">
                          {chunk.content && (
                            <div className="prose prose-sm dark:prose-invert max-w-none leading-[1.8]" style={{ color: '#1f2329' }}>
                              <ReactMarkdown
                                remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                                components={MARKDOWN_COMPONENTS}
                              >
                                {chunk.content}
                              </ReactMarkdown>
                            </div>
                          )}
                          {chunk.answer && (
                            <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                              <span className="text-xs text-slate-400">答案：</span>
                              <ReactMarkdown
                                remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                                components={MARKDOWN_COMPONENTS}
                              >
                                {chunk.answer}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </>
              )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================== Create Folder Dialog ==================== */}
      <Dialog
        open={showCreateFolder}
        onOpenChange={(o) => {
          if (!o) {
            setShowCreateFolder(false)
            setFolderName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">新建目录</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                目录名称 <span className="text-red-400">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="输入目录名称"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCreateFolder(false)
                setFolderName('')
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCreateFolder}
              disabled={creatingFolder || !folderName.trim()}
            >
              {creatingFolder && <Loader2 className="size-3.5 mr-1 animate-spin" />}创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Import Dialog ==================== */}
      <Dialog
        open={showImport}
        onOpenChange={(o) => {
          if (!o) {
            setShowImport(false)
            setImportFileBuffer(null)
            setImportFileName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">导入文件</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                选择文件 <span className="text-red-400">*</span>
              </label>
              <div className="mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = fileInputRef.current
                    if (input) {
                      input.value = ''
                      input.click()
                    }
                  }}
                  className="w-full justify-start"
                >
                  <FileText className="size-3.5 mr-2" />
                  {importFileName || '点击选择文件'}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">训练模式</label>
              <select
                className="mt-1 w-full h-8 text-xs border rounded-md px-2 bg-background"
                value={importTrainingType}
                onChange={(e) => setImportTrainingType(e.target.value)}
              >
                <option value="chunk">分段 (chunk)</option>
                <option value="qa">问答 (qa)</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowImport(false)
                setImportFileBuffer(null)
                setImportFileName('')
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleImportFile} disabled={importing || !importFileBuffer}>
              {importing && <Loader2 className="size-3.5 mr-1 animate-spin" />}导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Delete Confirmation Dialog ==================== */}
      <Dialog
        open={deleteConfirmItem !== null}
        onOpenChange={(o) => { if (!o) setDeleteConfirmItem(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm space-y-2">
                {deleteConfirmItem?.type === 'folder' ? (
                  <>
                    <p>删除目录后将同时删除其下所有内容。</p>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="font-medium">目录：{deleteConfirmItem.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        包含：{deleteConfirmItem.dataAmount ?? 0} 个文档
                        {deleteConfirmItem.tags?.[0] && ` · ${deleteConfirmItem.tags[0]}`}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p>确认删除此文档？</p>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="font-medium">{deleteConfirmItem?.name}</p>
                    </div>
                  </>
                )}
                <p className="text-xs text-muted-foreground">此操作不可恢复。</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmItem(null)}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={handleConfirmDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Leave Confirmation Dialog ==================== */}
      <Dialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>未保存的更改</DialogTitle>
            <DialogDescription>
              当前文档存在未发布内容，是否离开？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelLeave}>
              继续编辑
            </Button>
            <Button onClick={handleConfirmLeave}>
              离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
