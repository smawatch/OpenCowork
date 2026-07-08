import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { OutputData } from '@editorjs/editorjs'
import {
  BookOpen,
  Database,
  FileText,
  FileUp,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
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
  DialogFooter
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REHYPE_PLUGINS,
  createMarkdownComponents
} from '@renderer/lib/preview/viewers/markdown-components'
import { useAuthStore } from '@renderer/stores/auth-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
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
  listDatasets,
  listCollections,
  listChunks,
  KbApiError,
  type DatasetItem,
  type CollectionItem,
  type ChunkItem
} from '@renderer/lib/knowledge/kb-api-client'

function typeLabel(type: string): string {
  switch (type) {
    case 'virtual':
      return '手动录入'
    case 'link':
      return '网页链接'
    case 'folder':
      return '文件夹'
    default:
      return type || '未知'
  }
}

function typeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'virtual':
      return <Pencil className="size-3.5" />
    case 'link':
      return <Layers className="size-3.5" />
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
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return iso
  }
}

export function PersonalKnowledgeTab(): React.JSX.Element {
  const token = useAuthStore((s) => s.token)
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const isManager = user?.roles?.includes('manager') ?? false
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canEditKb = useCallback(
    (kb: DatasetItem) => {
      if (kb.source === 'department') {
        if (!user) return false
        return !!kb.creator && (kb.creator === user.username || kb.creator === user.displayName)
      }
      return true
    },
    [user]
  )
  const markdownComponents = useMemo(() => createMarkdownComponents(), [])

  const [datasets, setDatasets] = useState<DatasetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIntro, setNewIntro] = useState('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [customTagInput, setCustomTagInput] = useState('')
  const [newSource, setNewSource] = useState<'personal' | 'department'>('personal')
  const [creating, setCreating] = useState(false)

  // ---- edit KB dialog ----
  const [showEdit, setShowEdit] = useState(false)
  const [editKb, setEditKb] = useState<DatasetItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editIntro, setEditIntro] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [editCustomTag, setEditCustomTag] = useState('')
  const [editing, setEditing] = useState(false)

  const toggleEditTag = useCallback((tag: string) => {
    setEditTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  const addEditCustomTag = useCallback(() => {
    const trimmed = editCustomTag.trim()
    if (!trimmed || editTags.includes(trimmed)) return
    setEditTags((prev) => [...prev, trimmed])
    setEditCustomTag('')
  }, [editCustomTag, editTags])

  const openEditDialog = useCallback((kb: DatasetItem) => {
    setEditKb(kb)
    setEditName(kb.name)
    setEditIntro(kb.intro || '')
    setEditTags(kb.tags || [])
    setEditCustomTag('')
    setShowEdit(true)
  }, [])

  const handleEdit = useCallback(async () => {
    if (!editKb || !editName.trim()) return
    setEditing(true)
    try {
      const result = await updateDataset(ipcClient, {
        id: editKb.id,
        name: editName.trim(),
        intro: editIntro.trim() || undefined,
        tags: editTags
      })
      if (!result.success) {
        toast.error(result.error || result.message || '更新失败')
        return
      }
      toast.success('已更新')
      setShowEdit(false)
      setEditKb(null)
      // 刷新列表
      setLoading(true)
      const r = await listDatasets(ipcClient)
      if (r.success) setDatasets(r.data ?? [])
      setLoading(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '更新失败')
    } finally {
      setEditing(false)
    }
  }, [editKb, editName, editIntro, editTags])

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

  const [selectedKb, setSelectedKb] = useState<DatasetItem | null>(null)
  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionsError, setCollectionsError] = useState<string | null>(null)

  const [showImport, setShowImport] = useState(false)
  const [importFileBuffer, setImportFileBuffer] = useState<ArrayBuffer | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importTrainingType, setImportTrainingType] = useState('chunk')
  const [importing, setImporting] = useState(false)

  const [showTextCollection, setShowTextCollection] = useState(false)
  const [textColName, setTextColName] = useState('')
  const textColEditorDataRef = useRef<OutputData>({ blocks: [], time: Date.now() })
  const [textColHasContent, setTextColHasContent] = useState(false)
  const [textColTrainingType, setTextColTrainingType] = useState('chunk')
  const [textColQaPrompt, setTextColQaPrompt] = useState('')
  const [savingText, setSavingText] = useState(false)

  const [selectedCollection, setSelectedCollection] = useState<CollectionItem | null>(null)
  const [chunks, setChunks] = useState<ChunkItem[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState<string | null>(null)
  const [chunksTotal, setChunksTotal] = useState(0)

  const fetchDatasets = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await listDatasets(ipcClient)
      if (!result.success) {
        setError(result.error || result.message || '获取知识库列表失败')
        return
      }
      const list = result.data ?? []
      console.log('[个人知识库] 已加载:', list.map((ds) => `${ds.name} (${ds.id})`).join(', '))
      setDatasets(list)
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
        logout()
        return
      }
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }, [token, logout])

  useEffect(() => {
    fetchDatasets()
  }, [fetchDatasets])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const result = await createDataset(ipcClient, {
        name: newName.trim(),
        intro: newIntro.trim() || undefined,
        tags: newTags.length > 0 ? newTags : undefined,
        source: isManager ? newSource : undefined
      })
      if (!result.success) {
        toast.error(result.error || result.message || '创建失败')
        return
      }
      toast.success('知识库已创建')
      setShowCreate(false)
      setNewName('')
      setNewIntro('')
      setNewTags([])
      setCustomTagInput('')
      setNewSource('personal')
      fetchDatasets()
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
        logout()
        return
      }
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [newName, newIntro, newTags, fetchDatasets, logout])

  const openKbDetail = useCallback(
    async (kb: DatasetItem) => {
      setSelectedKb(kb)
      setCollectionsLoading(true)
      setCollectionsError(null)
      try {
        const result = await listCollections(ipcClient, kb.id)
        if (!result.success) {
          setCollectionsError(result.error || result.message || '获取集合列表失败')
          return
        }
        setCollections(result.data ?? [])
      } catch (err: unknown) {
        if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
          logout()
          return
        }
        setCollectionsError(err instanceof Error ? err.message : '网络错误')
      } finally {
        setCollectionsLoading(false)
      }
    },
    [logout]
  )

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
      const result = await importFileToDataset(ipcClient, {
        datasetId: selectedKb.id,
        fileName: importFileName,
        fileBuffer: importFileBuffer,
        trainingType: importTrainingType
      })
      if (!result.success) {
        toast.error(result.error || result.message || '导入失败')
        return
      }
      toast.success(`导入成功，${result.data?.results.insertLen ?? 0} 个分块`)
      setShowImport(false)
      setImportFileBuffer(null)
      setImportFileName('')
      openKbDetail(selectedKb)
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
        logout()
        return
      }
      toast.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }, [selectedKb, importFileBuffer, importFileName, importTrainingType, openKbDetail, logout])

  const handleCreateTextCollection = useCallback(async () => {
    const editorData = textColEditorDataRef.current
    const mdText = editorJsToMarkdown(editorData)
    if (!selectedKb || !textColName.trim() || !mdText.trim()) return
    setSavingText(true)
    try {
      const result = await createTextCollection(ipcClient, {
        datasetId: selectedKb.id,
        name: textColName.trim(),
        text: mdText,
        trainingType: textColTrainingType,
        qaPrompt:
          textColTrainingType === 'qa' && textColQaPrompt.trim()
            ? textColQaPrompt.trim()
            : undefined
      })
      if (!result.success) {
        toast.error(result.error || result.message || '创建失败')
        return
      }
      toast.success(`创建成功，${result.data?.results.insertLen ?? 0} 个分块`)
      setShowTextCollection(false)
      setTextColName('')
      textColEditorDataRef.current = { blocks: [], time: Date.now() }
      setTextColHasContent(false)
      setTextColQaPrompt('')
      openKbDetail(selectedKb)
    } catch (err: unknown) {
      if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
        logout()
        return
      }
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSavingText(false)
    }
  }, [selectedKb, textColName, textColTrainingType, textColQaPrompt, openKbDetail, logout])

  const openChunks = useCallback(async (collection: CollectionItem) => {
    setSelectedCollection(collection)
    setChunksLoading(true)
    setChunksError(null)
    try {
      const result = await listChunks(ipcClient, collection.id)
      if (!result.success) {
        setChunksError(result.error || result.message || '获取分块失败')
        return
      }
      setChunks(result.data ?? [])
      setChunksTotal(result.total ?? result.data?.length ?? 0)
    } catch (err: unknown) {
      setChunksError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setChunksLoading(false)
    }
  }, [])

  const handleDeleteCollection = useCallback(
    async (e: React.MouseEvent, item: CollectionItem) => {
      e.stopPropagation()
      if (!selectedKb) return
      try {
        const result = await deleteCollections(ipcClient, {
          datasetId: selectedKb.id,
          collectionIds: [item.id]
        })
        if (!result.success) {
          toast.error(result.error || result.message || '删除失败')
          return
        }
        toast.success('已删除')
        openKbDetail(selectedKb)
      } catch (err: unknown) {
        if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
          logout()
          return
        }
        toast.error(err instanceof Error ? err.message : '删除失败')
      }
    },
    [selectedKb, openKbDetail, logout]
  )

  const handleDeleteDataset = useCallback(
    async (e: React.MouseEvent, kb: DatasetItem) => {
      e.stopPropagation()
      try {
        const result = await deleteDataset(ipcClient, kb.id)
        if (!result.success) {
          toast.error(result.error || result.message || '删除失败')
          return
        }
        toast.success('知识库已删除')
        setSelectedKb(null)
        setCollections([])
        fetchDatasets()
      } catch (err: unknown) {
        if (err instanceof KbApiError && err.code === 'UNAUTHORIZED') {
          logout()
          return
        }
        toast.error(err instanceof Error ? err.message : '删除失败')
      }
    },
    [fetchDatasets, logout]
  )

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Database className="mb-3 size-10 opacity-30" />
        <p className="text-sm">请先登录</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" onClick={fetchDatasets} variant="outline" className="text-xs">
          <RefreshCw className="size-3.5 mr-1" />
          刷新
        </Button>
        <Button size="sm" className="text-xs" onClick={() => setShowCreate(true)}>
          <Plus className="size-3.5 mr-1" />
          创建知识库
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Database className="mb-3 size-10 opacity-30" />
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchDatasets}>
            <RefreshCw className="mr-1 size-3" /> 重试
          </Button>
        </div>
      ) : datasets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BookOpen className="mb-3 size-10 opacity-30" />
          <p className="text-sm">暂无个人知识库</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 size-3" /> 创建第一个知识库
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {datasets.map((ds) => (
            <button
              key={ds.id}
              className="group flex flex-col rounded-xl border bg-card p-5 text-left transition-all hover:border-primary/50 hover:shadow-md cursor-pointer relative"
              onClick={() => openKbDetail(ds)}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                  <BookOpen className="size-4 text-primary" />
                </div>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {ds.type || 'dataset'}
                </Badge>
                <div className="flex-1" />
                {canEditKb(ds) && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditDialog(ds)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-red-500"
                      onClick={(e) => handleDeleteDataset(e, ds)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
              <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                {ds.name}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {ds.intro || '这个知识库还没有介绍~'}
              </p>
              {(ds.tags && ds.tags.length > 0) && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(ds.tags || []).slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal text-muted-foreground">
                      {tag}
                    </Badge>
                  ))}
                  {(ds.tags?.length || 0) > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{ds.tags!.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Create Dataset Dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreate(false)
            setNewName('')
            setNewIntro('')
            setNewTags([])
            setCustomTagInput('')
            setNewSource('personal')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">创建个人知识库</DialogTitle>
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
            {isManager && (
              <div>
                <label className="text-xs text-muted-foreground">来源</label>
                <Select
                  value={newSource}
                  onValueChange={(v) => setNewSource(v as 'personal' | 'department')}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">个人</SelectItem>
                    <SelectItem value="department">部门</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
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
              {creating && <Loader2 className="size-3.5 mr-1 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dataset Dialog */}
      <Dialog
        open={showEdit}
        onOpenChange={(open) => {
          if (!open) { setShowEdit(false); setEditKb(null) }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">编辑知识库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">名称</label>
              <Input
                className="mt-1"
                placeholder="输入知识库名称"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">简介</label>
              <Textarea
                className="mt-1 min-h-20"
                placeholder="输入知识库简介（可选）"
                value={editIntro}
                onChange={(e) => setEditIntro(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">标签</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DEFAULT_TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleEditTag(tag)}
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                      editTags.includes(tag)
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
                  value={editCustomTag}
                  onChange={(e) => setEditCustomTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEditCustomTag() } }}
                />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addEditCustomTag}>
                  添加
                </Button>
              </div>
              {editTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {editTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[11px] px-1.5 py-0 h-5 gap-1">
                      {tag}
                      <span
                        className="cursor-pointer hover:text-red-500 ml-0.5"
                        onClick={() => toggleEditTag(tag)}
                      >×</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowEdit(false); setEditKb(null) }}>
              取消
            </Button>
            <Button size="sm" onClick={handleEdit} disabled={editing || !editName.trim()}>
              {editing && <Loader2 className="size-3.5 mr-1 animate-spin" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dataset Detail Dialog */}
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

          <div className="flex items-center gap-2 -mx-6 px-6">
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
              <FileUp className="size-3.5 mr-1" />
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
              <div className="py-16 text-center text-sm text-muted-foreground">
                暂无集合，导入文件或创建空白集来开始
              </div>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-red-500"
                        onClick={(e) => handleDeleteCollection(e, item)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import File Dialog */}
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
        <DialogContent className="max-w-md">
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
                  <FileUp className="size-3.5 mr-2" />
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
              {importing && <Loader2 className="size-3.5 mr-1 animate-spin" />}
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Text Collection Dialog */}
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
                  placeholder="输入需要导入知识库的文本内容，系统会自动分割..."
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
              {savingText && <Loader2 className="size-3.5 mr-1 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chunks Dialog */}
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
                            components={markdownComponents}
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
                            components={markdownComponents}
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
    </div>
  )
}
