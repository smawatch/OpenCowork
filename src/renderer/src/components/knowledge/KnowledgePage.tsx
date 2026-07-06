import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OutputData } from '@editorjs/editorjs'
import ReactMarkdown from 'react-markdown'
import {
  BookOpen,
  FileText,
  FolderPlus,
  Layers,
  Link,
  Loader2,
  Pencil,
  RefreshCw
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui/dialog'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useAuthStore } from '@renderer/stores/auth-store'
import { toast } from 'sonner'
import { EditorJsRichText } from '@renderer/components/editorjs/EditorJsRichText'
import {
  editorJsToMarkdown,
  editorJsToPlainText
} from '@renderer/lib/editorjs/editorjs-to-markdown'
import {
  createDataset,
  updateDataset,
  deleteDataset,
  deleteCollections,
  importFileToDataset,
  createTextCollection,
  createFolder,
  listDatasets,
  listCollections,
  listChunks,
  KbApiError,
  type DatasetItem,
  type CollectionItem,
  type ChunkItem,
} from '@renderer/lib/knowledge/kb-api-client'
import { KnowledgeToolbar, type SortField, type SortDir } from './KnowledgeToolbar'
import { KnowledgeRow } from './KnowledgeRow'
import { KnowledgeDetail } from './KnowledgeDetail'
import { parseKnowledgeRoute, goToKnowledgeDetail } from '@renderer/lib/knowledge-route'
import {
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REHYPE_PLUGINS,
  createMarkdownComponents
} from '@renderer/lib/preview/viewers/markdown-components'

const MARKDOWN_COMPONENTS = createMarkdownComponents()

// --------------- helpers ---------------

function augmentDataset(ds: DatasetItem, index: number, isPersonal: boolean): DatasetItem {
  const tagPools = [
    ['技术', 'AI', '后端'],
    ['运营', '活动'],
    ['产品', '需求'],
    ['客服', 'FAQ'],
    ['支付', 'Java', 'SpringBoot'],
    ['IoT', '嵌入式'],
    ['前端', 'React', 'TypeScript'],
    ['数据', '分析']
  ]
  return {
    ...ds,
    systemTag: ds.systemTag || (isPersonal ? '个人' : '企业'),
    tags: ds.tags || tagPools[index % tagPools.length],
    creator: ds.creator || `创建人${String.fromCharCode(65 + (index % 26))}`,
    updateTime: ds.updateTime || new Date(Date.now() - index * 86400000 * 3).toISOString()
  }
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

function typeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'virtual':
      return <Pencil className="size-3.5" />
    case 'link':
      return <Link className="size-3.5" />
    case 'folder':
      return <Layers className="size-3.5" />
    default:
      return <FileText className="size-3.5" />
  }
}

function trainingTypeLabel(t: string): string {
  switch (t) {
    case 'chunk':
      return '分段'
    case 'qa':
      return '问答'
    default:
      return t
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}

// --------------- main component ---------------

type PageKb = DatasetItem & { kind: 'personal' | 'enterprise' }
type ApiResponse<T> = { success: boolean; data: T; total?: number; error?: string; code?: string }

export function KnowledgePage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const token = useAuthStore((s) => s.token)
  const logout = useAuthStore((s) => s.logout)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- data ----
  const [allKbs, setAllKbs] = useState<PageKb[]>([])
  const [loading, setLoading] = useState(true)

  // ---- route ----
  const [route, setRoute] = useState(() => parseKnowledgeRoute(window.location.hash))

  useEffect(() => {
    const handler = () => setRoute(parseKnowledgeRoute(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Sync hash for list view (handles sidebar navigation to knowledge page)
  useEffect(() => {
    if (route.kind === 'list' && window.location.hash !== '#/knowledge') {
      window.history.replaceState(null, '', '#/knowledge')
    }
  }, [route.kind])

  // ---- UI state ----
  const [search, setSearch] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [sortField, setSortField] = useState<SortField>('updateTime')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // ---- create KB dialog ----
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIntro, setNewIntro] = useState('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [customTagInput, setCustomTagInput] = useState('')
  const [creating, setCreating] = useState(false)

  // ---- edit KB ----
  const [showEditKb, setShowEditKb] = useState(false)
  const [editingKb, setEditingKb] = useState<DatasetItem | null>(null)
  const [editKbTags, setEditKbTags] = useState<string[]>([])
  const [editing, setEditing] = useState(false)

  const [editKbName, setEditKbName] = useState('')

  const openEditKb = useCallback((kb: DatasetItem) => {
    setEditingKb(kb)
    setEditKbName(kb.name)
    setEditKbTags(kb.tags || [])
    setShowEditKb(true)
  }, [])

  const toggleEditKbTag = useCallback((tag: string) => {
    setEditKbTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }, [])

  const handleEditKb = useCallback(async () => {
    if (!editingKb || !editKbName.trim()) return
    setEditing(true)
    try {
      const r = await updateDataset(ipcClient, {
        id: editingKb.id,
        name: editKbName.trim() !== editingKb.name ? editKbName.trim() : undefined,
        tags: editKbTags
      })
      if (!r.success) { toast.error(r.error || '更新失败'); return }
      toast.success('已更新')
      setShowEditKb(false)
      // 更新本地列表
      setAllKbs((prev) =>
        prev.map((k) =>
          k.id === editingKb.id ? { ...k, name: editKbName.trim(), tags: editKbTags } : k
        )
      )
      setEditingKb(null)
    } catch { toast.error('更新失败') }
    finally { setEditing(false) }
  }, [editingKb, editKbName, editKbTags])

  const DEFAULT_TAG_OPTIONS = ['运营', '测试', '技术', '产品', '需求', '开发', '后端', '前端', 'AI', '文档']

  const toggleNewTag = useCallback((tag: string) => {
    setNewTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  const addCustomTag = useCallback(() => {
    const trimmed = customTagInput.trim()
    if (!trimmed) return
    if (newTags.includes(trimmed)) return
    setNewTags((prev) => [...prev, trimmed])
    setCustomTagInput('')
  }, [customTagInput, newTags])

  // ---- delete confirmation ----
  const [deleteTargetKb, setDeleteTargetKb] = useState<DatasetItem | null>(null)

  // ---- detail dialog (collections) ----
  const [selectedKb, setSelectedKb] = useState<PageKb | null>(null)
  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionsError, setCollectionsError] = useState<string | null>(null)

  // ---- import dialog ----
  const [showImport, setShowImport] = useState(false)
  const [importFileBuffer, setImportFileBuffer] = useState<ArrayBuffer | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importTrainingType, setImportTrainingType] = useState('chunk')
  const [importing, setImporting] = useState(false)

  // ---- text collection dialog ----
  const [showTextCollection, setShowTextCollection] = useState(false)
  const [textColName, setTextColName] = useState('')
  const textColEditorDataRef = useRef<OutputData>({ blocks: [], time: Date.now() })
  const [textColHasContent, setTextColHasContent] = useState(false)
  const [textColTrainingType, setTextColTrainingType] = useState('chunk')
  const [textColQaPrompt, setTextColQaPrompt] = useState('')
  const [savingText, setSavingText] = useState(false)

  // ---- folder creation dialog ----
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  // ---- chunks dialog ----
  const [selectedCollection, setSelectedCollection] = useState<CollectionItem | null>(null)
  const [chunks, setChunks] = useState<ChunkItem[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState<string | null>(null)
  const [chunksTotal, setChunksTotal] = useState(0)

  // ==================== data fetching ====================

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const merged: PageKb[] = []
    let idx = 0
    // personal
    if (token) {
      try {
        const r = await listDatasets(ipcClient)
        if (r.success) {
          const items = (r.data ?? []).map((d) => {
            const page = {
              ...augmentDataset(d, idx, true),
              kind: 'personal' as const
            }
            idx++
            return page
          })
          merged.push(...items)
        }
      } catch {
        /* silent */
      }
    }
    // enterprise
    try {
      const r = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_DATASETS)) as ApiResponse<
        DatasetItem[]
      > & { code?: string }
      if (r.code === 'UNAUTHORIZED') logout()
      if (r.success) {
        const items = (r.data ?? []).map((d) => {
          const page = {
            ...augmentDataset(d, idx, false),
            kind: 'enterprise' as const
          }
          idx++
          return page
        })
        merged.push(...items)
      }
    } catch {
      /* silent */
    }
    setAllKbs(merged)
    setLoading(false)
  }, [token, logout])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // 从详情页返回列表时重新拉取数据
  const prevRouteKindRef = useRef(route.kind)
  useEffect(() => {
    if (prevRouteKindRef.current === 'detail' && route.kind === 'list') {
      fetchAll()
    }
    prevRouteKindRef.current = route.kind
  }, [route.kind, fetchAll])

  // ==================== filtered & sorted ====================

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const kb of allKbs) {
      for (const tag of kb.tags || []) set.add(tag)
    }
    return Array.from(set).sort()
  }, [allKbs])

  const filterSort = useCallback(
    <T extends DatasetItem>(list: T[]): T[] => {
      let filtered = list
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        filtered = filtered.filter((kb) => kb.name.toLowerCase().includes(q))
      }
      if (activeTags.length > 0) {
        filtered = filtered.filter((kb) => {
          const kt = kb.tags || []
          return activeTags.some((t) => kt.includes(t))
        })
      }
      return [...filtered].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        switch (sortField) {
          case 'name':
            return dir * a.name.localeCompare(b.name, 'zh-Hans')
          case 'updateTime':
          default:
            return (
              dir * (new Date(a.updateTime || 0).getTime() - new Date(b.updateTime || 0).getTime())
            )
        }
      })
    },
    [search, activeTags, sortField, sortDir]
  )

  const filteredKbs = useMemo(() => filterSort(allKbs), [allKbs, filterSort])

  // ==================== create KB ====================

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const r = await createDataset(ipcClient, {
        name: newName.trim(),
        intro: newIntro.trim() || undefined,
        tags: newTags.length > 0 ? newTags : undefined
      })
      if (!r.success) {
        toast.error(r.error || r.message || '创建失败')
        return
      }
      toast.success('知识库已创建')
      setShowCreate(false)
      setNewName('')
      setNewIntro('')
      setNewTags([])
      setCustomTagInput('')
      fetchAll()
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
      else toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [newName, newIntro, newTags, fetchAll, logout])

  // ==================== detail (collections) ====================

  const openKbDetail = useCallback(
    async (kb: PageKb) => {
      setSelectedKb(kb)
      setCollectionsLoading(true)
      setCollectionsError(null)
      try {
        const r = await listCollections(ipcClient, kb.id)
        if (!r.success) {
          setCollectionsError(r.error || r.message || '获取失败')
          return
        }
        setCollections(r.data ?? [])
      } catch (err: unknown) {
        if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
        else setCollectionsError(err instanceof Error ? err.message : '网络错误')
      } finally {
        setCollectionsLoading(false)
      }
    },
    [logout]
  )

  // ==================== delete KB ====================

  const handleDeleteKb = useCallback(
    (kb: DatasetItem) => {
      setDeleteTargetKb(kb)
    },
    []
  )

  const handleConfirmDeleteKb = useCallback(async () => {
    const kb = deleteTargetKb
    if (!kb) return
    setDeleteTargetKb(null)
    try {
      const r = await deleteDataset(ipcClient, kb.id)
      if (!r.success) {
        toast.error(r.error || r.message || '删除失败')
        return
      }
      toast.success('已删除')
      setSelectedKb(null)
      setCollections([])
      fetchAll()
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
      else toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }, [deleteTargetKb, fetchAll, logout])

  // ==================== import ====================

  const handleSelectFile = useCallback(() => {
    const input = fileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [])

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

  const handleImportFile = useCallback(async () => {
    if (!selectedKb || !importFileBuffer) return
    setImporting(true)
    try {
      const r = await importFileToDataset(ipcClient, {
        datasetId: selectedKb.id,
        fileName: importFileName,
        fileBuffer: importFileBuffer,
        trainingType: importTrainingType
      })
      if (!r.success) {
        toast.error(r.error || r.message || '导入失败')
        return
      }
      toast.success(`导入成功，${r.data?.results.insertLen ?? 0} 个分块`)
      setShowImport(false)
      setImportFileBuffer(null)
      setImportFileName('')
      openKbDetail(selectedKb)
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
      else toast.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }, [selectedKb, importFileBuffer, importFileName, importTrainingType, openKbDetail, logout])

  // ==================== text collection ====================

  const handleCreateTextCollection = useCallback(async () => {
    const mdText = editorJsToMarkdown(textColEditorDataRef.current)
    if (!selectedKb || !textColName.trim() || !mdText.trim()) return
    setSavingText(true)
    try {
      const r = await createTextCollection(ipcClient, {
        datasetId: selectedKb.id,
        name: textColName.trim(),
        text: mdText,
        trainingType: textColTrainingType,
        qaPrompt:
          textColTrainingType === 'qa' && textColQaPrompt.trim()
            ? textColQaPrompt.trim()
            : undefined
      })
      if (!r.success) {
        toast.error(r.error || r.message || '创建失败')
        return
      }
      toast.success(`创建成功，${r.data?.results.insertLen ?? 0} 个分块`)
      setShowTextCollection(false)
      setTextColName('')
      textColEditorDataRef.current = { blocks: [], time: Date.now() }
      setTextColHasContent(false)
      setTextColQaPrompt('')
      openKbDetail(selectedKb)
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
      else toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSavingText(false)
    }
  }, [selectedKb, textColName, textColTrainingType, textColQaPrompt, openKbDetail, logout])

  // ==================== create folder ====================

  const handleCreateFolder = useCallback(async () => {
    if (!selectedKb || !folderName.trim()) return
    setCreatingFolder(true)
    try {
      const r = await createFolder(ipcClient, {
        datasetId: selectedKb.id,
        name: folderName.trim()
      })
      if (!r.success) {
        toast.error(r.error || r.message || '创建失败')
        return
      }
      toast.success('目录已创建')
      setShowCreateFolder(false)
      setFolderName('')
      openKbDetail(selectedKb)
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
      else toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreatingFolder(false)
    }
  }, [selectedKb, folderName, openKbDetail, logout])

  // ==================== delete collection ====================

  const handleDeleteCollection = useCallback(
    async (e: React.MouseEvent, item: CollectionItem) => {
      e.stopPropagation()
      if (!selectedKb) return
      try {
        const r = await deleteCollections(ipcClient, {
          datasetId: selectedKb.id,
          collectionIds: [item.id]
        })
        if (!r.success) {
          toast.error(r.error || r.message || '删除失败')
          return
        }
        toast.success('已删除')
        openKbDetail(selectedKb)
      } catch (err: unknown) {
        if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') logout()
        else toast.error(err instanceof Error ? err.message : '删除失败')
      }
    },
    [selectedKb, openKbDetail, logout]
  )

  // ==================== chunks ====================

  const openChunks = useCallback(async (collection: CollectionItem) => {
    setSelectedCollection(collection)
    setChunksLoading(true)
    setChunksError(null)
    try {
      const r = await listChunks(ipcClient, collection.id)
      if (!r.success) {
        setChunksError(r.error || r.message || '获取失败')
        return
      }
      setChunks(r.data ?? [])
      setChunksTotal(r.total ?? r.data?.length ?? 0)
    } catch (err: unknown) {
      setChunksError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setChunksLoading(false)
    }
  }, [])

  // ==================== JSX ====================

  if (route.kind === 'detail' && route.kbId) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <KnowledgeDetail kbId={route.kbId} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />

      {/* Page Header */}
      <div className="border-b px-6 py-5 flex items-center justify-between" style={{ borderColor: '#f1f3f5' }}>
        <h1 className="text-xl font-bold" style={{ color: '#1f2329' }}>
          {t('knowledgePage.title', { defaultValue: '知识库' })}
        </h1>
      </div>

      {/* Toolbar */}
      <KnowledgeToolbar
        search={search}
        onSearchChange={setSearch}
        activeTags={activeTags}
        onTagsChange={setActiveTags}
        allTags={allTags}
        sortField={sortField}
        sortDir={sortDir}
        onSortChange={(f, d) => {
          setSortField(f)
          setSortDir(d)
        }}
        onCreate={() => {
          setNewName('')
          setNewIntro('')
          setShowCreate(true)
        }}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {loading && (
          <div className="space-y-4 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Content */}
        {!loading && filteredKbs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <BookOpen className="mb-3 size-10 opacity-30" />
            <p className="text-sm">暂无知识库</p>
          </div>
        )}
        {!loading && filteredKbs.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: '#f1f3f5' }}>
                <th className="px-6 py-2.5 text-left text-[13px] font-medium" style={{ color: '#999' }}>
                  名称
                </th>
                <th className="px-6 py-2.5 text-left text-[13px] font-medium" style={{ color: '#999' }}>
                  标签
                </th>
                <th className="px-6 py-2.5 text-left text-[13px] font-medium" style={{ color: '#999' }}>
                  创建人
                </th>
                <th className="px-6 py-2.5 text-left text-[13px] font-medium" style={{ color: '#999' }}>
                  更新时间
                </th>
                <th className="px-6 py-2.5 text-right text-[13px] font-medium w-16" style={{ color: '#999' }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredKbs.map((kb) => (
                <KnowledgeRow
                  key={kb.id}
                  kb={kb}
                  onEnter={() => goToKnowledgeDetail(kb.id)}
                  onEdit={kb.kind === 'personal' ? () => openEditKb(kb) : undefined}
                  onDelete={kb.kind === 'personal' ? () => handleDeleteKb(kb) : undefined}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ==================== Create KB Dialog ==================== */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreate(false)
            setNewName('')
            setNewIntro('')
            setNewTags([])
            setCustomTagInput('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">创建知识库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                名称 <span className="text-red-400">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="输入知识库名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">简介</label>
              <Textarea
                className="mt-1 min-h-20"
                placeholder="输入知识库简介（可选）"
                value={newIntro}
                onChange={(e) => setNewIntro(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">标签</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DEFAULT_TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleNewTag(tag)}
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                      newTags.includes(tag)
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="自定义标签..."
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
                />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addCustomTag}>
                  添加
                </Button>
              </div>
              {newTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {newTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[11px] px-1.5 py-0 h-5 gap-1">
                      {tag}
                      <span
                        className="cursor-pointer hover:text-red-500 ml-0.5"
                        onClick={() => toggleNewTag(tag)}
                      >
                        ×
                      </span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCreate(false)
                setNewName('')
                setNewIntro('')
                setNewTags([])
                setCustomTagInput('')
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="size-3.5 mr-1 animate-spin" />}创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Detail (Collections) Dialog ==================== */}
      <Dialog
        open={!!selectedKb}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedKb(null)
            setCollections([])
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4 text-primary" /> {selectedKb?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedKb?.intro && (
            <p className="-mt-2 text-xs text-muted-foreground">{selectedKb.intro}</p>
          )}
          {selectedKb?.kind === 'personal' && (
            <div className="flex items-center gap-2 -mx-6 px-6">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setFolderName('')
                  setShowCreateFolder(true)
                }}
              >
                <FolderPlus className="size-3.5 mr-1" />
                新建目录
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setImportFileBuffer(null)
                  setImportFileName('')
                  setShowImport(true)
                }}
              >
                <FileText className="size-3.5 mr-1" />
                导入文件
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setTextColName('')
                  textColEditorDataRef.current = { blocks: [], time: Date.now() }
                  setTextColHasContent(false)
                  setTextColTrainingType('chunk')
                  setTextColQaPrompt('')
                  setShowTextCollection(true)
                }}
              >
                <Pencil className="size-3.5 mr-1" />
                创建空白集
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => selectedKb && openKbDetail(selectedKb)}
              >
                <RefreshCw className="size-3.5 mr-1" />
                刷新
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {collectionsLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> 加载中...
              </div>
            ) : collectionsError ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-red-500">
                <p>{collectionsError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedKb && openKbDetail(selectedKb)}
                >
                  重试
                </Button>
              </div>
            ) : collections.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无集合</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    共 {collections.length} 个集合
                  </span>
                </div>
                <div className="divide-y">
                  {collections.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-6 py-4 hover:bg-muted/30 transition-colors"
                    >
                      <button
                        className="flex-1 text-left cursor-pointer min-w-0"
                        onClick={() => openChunks(item)}
                      >
                        <div className="flex items-center gap-2">
                          {typeIcon(item.type)}
                          <span className="text-sm font-medium truncate">{item.name}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{typeLabel(item.type)}</span>
                          <span>·</span>
                          <span>{trainingTypeLabel(item.trainingType)}</span>
                          <span>·</span>
                          <span>{item.dataAmount} 条数据</span>
                          <span>·</span>
                          <span>{formatDate(item.updateTime)}</span>
                        </div>
                        {item.tags && item.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.tags.map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>
                      {selectedKb?.kind === 'personal' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-red-500"
                          onClick={(e) => handleDeleteCollection(e, item)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <path d="M2 4h10M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M11 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                          </svg>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== Import File Dialog ==================== */}
      <Dialog
        open={showImport}
        onOpenChange={(open) => {
          if (!open) {
            setShowImport(false)
            setImportFileBuffer(null)
            setImportFileName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">导入文件到「{selectedKb?.name}」</DialogTitle>
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
                  onClick={handleSelectFile}
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

      {/* ==================== Create Folder Dialog ==================== */}
      <Dialog
        open={showCreateFolder}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateFolder(false)
            setFolderName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">新建目录到「{selectedKb?.name}」</DialogTitle>
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
              {creatingFolder && <Loader2 className="size-3.5 mr-1 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Create Text Collection Dialog ==================== */}
      <Dialog
        open={showTextCollection}
        onOpenChange={(open) => {
          if (!open) {
            setShowTextCollection(false)
            setTextColName('')
            textColEditorDataRef.current = { blocks: [], time: Date.now() }
            setTextColHasContent(false)
            setTextColQaPrompt('')
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">创建空白集到「{selectedKb?.name}」</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                集合名称 <span className="text-red-400">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="输入集合名称"
                value={textColName}
                onChange={(e) => setTextColName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                文本内容 <span className="text-red-400">*</span>
              </label>
              <div className="mt-1">
                <EditorJsRichText
                  placeholder="输入需要导入知识库的文本内容..."
                  onChange={(data) => {
                    textColEditorDataRef.current = data
                    setTextColHasContent(editorJsToPlainText(data).trim().length > 0)
                  }}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">训练模式</label>
              <select
                className="mt-1 w-full h-8 text-xs border rounded-md px-2 bg-background"
                value={textColTrainingType}
                onChange={(e) => setTextColTrainingType(e.target.value)}
              >
                <option value="chunk">分段 (chunk)</option>
                <option value="qa">问答 (qa)</option>
              </select>
            </div>
            {textColTrainingType === 'qa' && (
              <div>
                <label className="text-xs text-muted-foreground">QA Prompt</label>
                <Textarea
                  className="mt-1 min-h-16"
                  placeholder="输入 QA 模式的 prompt（可选）"
                  value={textColQaPrompt}
                  onChange={(e) => setTextColQaPrompt(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowTextCollection(false)
                setTextColName('')
                textColEditorDataRef.current = { blocks: [], time: Date.now() }
                setTextColHasContent(false)
                setTextColQaPrompt('')
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCreateTextCollection}
              disabled={savingText || !textColName.trim() || !textColHasContent}
            >
              {savingText && <Loader2 className="size-3.5 mr-1 animate-spin" />}创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Chunks Dialog ==================== */}
      <Dialog
        open={!!selectedCollection}
        onOpenChange={(open) => {
          if (!open) setSelectedCollection(null)
        }}
      >
        <DialogContent className="sm:max-w-[95vw] max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {typeIcon(selectedCollection?.type || '')}
              {selectedCollection?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {chunksLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> 加载中...
              </div>
            ) : chunksError ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-red-500">
                <p>{chunksError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedCollection && openChunks(selectedCollection)}
                >
                  重试
                </Button>
              </div>
            ) : chunks.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无分块数据</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5">
                  <span className="text-xs text-muted-foreground">共 {chunksTotal} 条分块</span>
                </div>
                <div className="divide-y">
                  {chunks.map((chunk) => (
                    <div key={chunk.id} className="px-6 py-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                          #{chunk.chunkIndex}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {chunk.sourceName}
                        </span>
                      </div>
                      {chunk.content && (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
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
                        <div className="mt-2 rounded bg-muted/50 px-3 py-2 prose prose-sm dark:prose-invert max-w-none">
                          <span className="text-xs text-muted-foreground">答案：</span>
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
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== Edit KB Dialog (名称 + 标签) ==================== */}
      <Dialog open={showEditKb} onOpenChange={(o) => { if (!o) { setShowEditKb(false); setEditingKb(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">编辑知识库</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 名称 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">名称</label>
              <Input
                value={editKbName}
                onChange={(e) => setEditKbName(e.target.value)}
                placeholder="知识库名称"
                className="text-sm"
              />
            </div>
            {/* 标签 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">标签</label>
              <div className="flex flex-wrap gap-1.5">
              {DEFAULT_TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleEditKbTag(tag)}
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                    editKbTags.includes(tag)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
            {editKbTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {editKbTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[11px] px-1.5 py-0 h-5 gap-1">
                    {tag}
                    <span className="cursor-pointer hover:text-red-500 ml-0.5" onClick={() => toggleEditKbTag(tag)}>×</span>
                  </Badge>
                ))}
              </div>
            )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowEditKb(false); setEditingKb(null) }}>取消</Button>
            <Button size="sm" onClick={handleEditKb} disabled={editing}>
              {editing && <Loader2 className="size-3.5 mr-1 animate-spin" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Delete KB Confirmation Dialog ==================== */}
      <Dialog
        open={deleteTargetKb !== null}
        onOpenChange={(o) => { if (!o) setDeleteTargetKb(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除知识库</DialogTitle>
            <DialogDescription>
              <div className="text-sm space-y-2">
                <p>删除知识库后将同时删除其下所有文档和目录。</p>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="font-medium">知识库：{deleteTargetKb?.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    此操作不可恢复。
                  </p>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTargetKb(null)}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={handleConfirmDeleteKb}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
