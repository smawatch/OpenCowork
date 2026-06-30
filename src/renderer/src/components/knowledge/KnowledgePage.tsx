import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  BrainCircuit,
  Database,
  FileText,
  FileUp,
  Layers,
  Link,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useAuthStore } from '@renderer/stores/auth-store'
import {
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REHYPE_PLUGINS,
  createMarkdownComponents
} from '@renderer/lib/preview/viewers/markdown-components'
import { toast } from 'sonner'
import { confirm } from '@renderer/components/ui/confirm-dialog'

type Tab = 'enterprise' | 'local'

interface DatasetItem {
  id: string
  name: string
  intro?: string
  type: string
}

interface CollectionItem {
  id: string
  name: string
  type: string
  trainingType: string
  dataAmount: number
  tags: string[]
  updateTime: string
}

interface ChunkItem {
  id: string
  content: string
  answer: string
  chunkIndex: number
  sourceName: string
}

interface LocalDocItem {
  id: string
  title: string
  created_at: number
  updated_at: number
  chunk_count: number
}

interface LocalChunkItem {
  id: string
  document_id: string
  content: string
  chunk_index: number
}

interface SearchResult {
  id: string
  document_id: string
  content: string
  chunk_index: number
  document_title: string
}

type ApiResponse<T> = { success: boolean; data: T; total?: number; error?: string }

function formatTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function typeLabel(type: string): string {
  switch (type) {
    case 'virtual': return '手动录入'
    case 'link': return '网页链接'
    case 'folder': return '文件夹'
    default: return type
  }
}

function typeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'virtual': return <Pencil className="size-3.5" />
    case 'link': return <Link className="size-3.5" />
    case 'folder': return <Layers className="size-3.5" />
    default: return <FileText className="size-3.5" />
  }
}

function trainingTypeLabel(t: string): string {
  switch (t) {
    case 'chunk': return '分段'
    case 'qa': return '问答'
    default: return t
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch { return iso }
}

export function KnowledgePage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const markdownComponents = useMemo(() => createMarkdownComponents(), [])
  const [tab, setTab] = useState<Tab>('enterprise')

  // ---- Enterprise KB state ----
  const [datasets, setDatasets] = useState<DatasetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKb, setSelectedKb] = useState<DatasetItem | null>(null)
  const [collections, setCollections] = useState<{
    loading: boolean; total: number; items: CollectionItem[]; error: string | null
  }>({ loading: false, total: 0, items: [], error: null })
  const [selectedCollection, setSelectedCollection] = useState<CollectionItem | null>(null)
  const [chunks, setChunks] = useState<{
    loading: boolean; total: number; items: ChunkItem[]; error: string | null
  }>({ loading: false, total: 0, items: [], error: null })

  // ---- Local KB state ----
  const [localDocs, setLocalDocs] = useState<LocalDocItem[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localSearch, setLocalSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [viewDocTitle, setViewDocTitle] = useState('')
  const [viewDocChunks, setViewDocChunks] = useState<LocalChunkItem[]>([])
  const [showViewChunks, setShowViewChunks] = useState(false)
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword')
  const [embedding, setEmbedding] = useState(false)
  const [cleaningStates, setCleaningStates] = useState<Record<string, string>>({})

  // Poll cleaning status
  const pollCleaning = useCallback(async () => {
    const cleaning = Object.entries(cleaningStates).filter(([, v]) => v === 'cleaning')
    if (cleaning.length === 0) return
    for (const [docId] of cleaning) {
      const res = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_CLEANING_STATUS, { documentId: docId }) as ApiResponse<{ status: string }>
      if (res.success) {
        setCleaningStates((prev) => {
          if (prev[docId] === res.data!.status) return prev
          const next = { ...prev, [docId]: res.data!.status }
          if (res.data!.status !== 'cleaning') {
            // Refresh list to get cleaned chunks count
            setTimeout(() => fetchLocalDocs(), 500)
          }
          return next
        })
      }
    }
  }, [cleaningStates])

  useEffect(() => {
    const timer = setInterval(pollCleaning, 3000)
    return () => clearInterval(timer)
  }, [pollCleaning])

  const handleAuthError = useCallback((result: { code?: string }) => {
    if (result.code === 'UNAUTHORIZED') useAuthStore.getState().logout()
  }, [])

  // ---- Enterprise KB fetchers ----
  const fetchDatasets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_DATASETS)) as ApiResponse<DatasetItem[]> & { code?: string }
      handleAuthError(result)
      if (!result.success) { setError(result.error || '获取知识库列表失败'); return }
      setDatasets(result.data ?? [])
    } catch (err: any) { setError(err.message || '网络错误') }
    finally { setLoading(false) }
  }, [])

  const openKbDetail = useCallback(async (kb: DatasetItem) => {
    setSelectedKb(kb)
    setCollections({ loading: true, total: 0, items: [], error: null })
    try {
      const result = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_COLLECTIONS, { kbId: kb.id })) as ApiResponse<CollectionItem[]> & { code?: string }
      handleAuthError(result)
      if (!result.success) { setCollections({ loading: false, total: 0, items: [], error: result.error || '获取数据集失败' }); return }
      setCollections({ loading: false, total: result.total ?? result.data?.length ?? 0, items: result.data ?? [], error: null })
    } catch (err: any) { setCollections({ loading: false, total: 0, items: [], error: err.message || '网络错误' }) }
  }, [])

  const openChunks = useCallback(async (collection: CollectionItem) => {
    setSelectedCollection(collection)
    setChunks({ loading: true, total: 0, items: [], error: null })
    try {
      const result = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_CHUNKS, { collectionId: collection.id })) as ApiResponse<ChunkItem[]> & { code?: string }
      handleAuthError(result)
      if (!result.success) { setChunks({ loading: false, total: 0, items: [], error: result.error || '获取分块失败' }); return }
      setChunks({ loading: false, total: result.total ?? result.data?.length ?? 0, items: result.data ?? [], error: null })
    } catch (err: any) { setChunks({ loading: false, total: 0, items: [], error: err.message || '网络错误' }) }
  }, [])

  const closeEnterDialog = useCallback(() => {
    setSelectedKb(null)
    setCollections({ loading: false, total: 0, items: [], error: null })
    setSelectedCollection(null)
    setChunks({ loading: false, total: 0, items: [], error: null })
  }, [])

  // ---- Local KB fetchers ----
  const fetchLocalDocs = useCallback(async () => {
    setLocalLoading(true)
    try {
      const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_LIST) as ApiResponse<LocalDocItem[]>
      if (result.success) {
        const docs = result.data ?? []
        setLocalDocs(docs)
        // Restore cleaning states for any in-progress docs
        const states: Record<string, string> = {}
        for (const doc of docs) {
          const statusRes = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_CLEANING_STATUS, { documentId: doc.id }) as ApiResponse<{ status: string }>
          if (statusRes.success && statusRes.data?.status !== 'ready') {
            states[doc.id] = statusRes.data!.status
          }
        }
        setCleaningStates(states)
      }
    } catch (err: any) { toast.error(err.message || '获取本地文档失败') }
    finally { setLocalLoading(false) }
  }, [])

  const handleCreateDoc = useCallback(async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    setSaving(true)
    try {
      const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_CREATE, { title: newTitle.trim(), content: newContent }) as ApiResponse<LocalDocItem>
      if (result.success) {
        toast.success('文档已保存')
        setShowAddDoc(false)
        setNewTitle('')
        setNewContent('')
        fetchLocalDocs()
      } else { toast.error(result.error || '保存失败') }
    } catch (err: any) { toast.error(err.message || '保存失败') }
    finally { setSaving(false) }
  }, [newTitle, newContent])

  const handleDeleteDoc = useCallback(async (doc: LocalDocItem) => {
    const ok = await confirm({ title: t('knowledgePage.local.confirmDelete', { defaultValue: '确定删除此文档？' }) })
    if (!ok) return
    try {
      const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_DELETE, { id: doc.id }) as ApiResponse<void>
      if (result.success) fetchLocalDocs()
      else toast.error(result.error || '删除失败')
    } catch (err: any) { toast.error(err.message || '删除失败') }
  }, [])

  const handleViewChunks = useCallback(async (doc: LocalDocItem) => {
    setViewDocTitle(doc.title)
    setShowViewChunks(true)
    try {
      const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_GET_CHUNKS, { documentId: doc.id }) as ApiResponse<LocalChunkItem[]>
      setViewDocChunks(result.success ? (result.data ?? []) : [])
    } catch { setViewDocChunks([]) }
  }, [])

  const handleSearch = useCallback(async (query: string) => {
    setLocalSearch(query)
    if (!query.trim()) { setSearchResults(null); return }
    try {
      if (searchMode === 'semantic') {
        const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_SEARCH_SEMANTIC, { query: query.trim() }) as ApiResponse<Array<{ id: string; content: string; score: number }>>
        if (result.success) {
          setSearchResults((result.data ?? []).map((r) => ({ id: r.id, content: r.content, chunk_index: 0, document_id: '', document_title: `${(r.score * 100).toFixed(0)}% 匹配` })))
        } else { toast.error(result.error || '搜索失败') }
      } else {
        const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_SEARCH, { query: query.trim() }) as ApiResponse<SearchResult[]>
        setSearchResults(result.success ? (result.data ?? []) : [])
      }
    } catch { setSearchResults([]) }
  }, [searchMode])

  const handleImportFile = useCallback(async () => {
    try {
      const fileResult = await ipcClient.invoke(IPC.FS_SELECT_FILE) as { canceled?: boolean; path?: string }
      if (fileResult?.canceled || !fileResult?.path) return
      const title = fileResult.path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
      const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_IMPORT_FILE, { filePath: fileResult.path, title }) as ApiResponse<LocalDocItem>
      if (result?.success) {
        toast.success('文件已导入')
        if (result.data?.id) setCleaningStates((prev) => ({ ...prev, [result.data!.id]: 'cleaning' }))
        fetchLocalDocs()
      } else toast.error(result?.error || '导入失败')
    } catch (err: any) {
      toast.error(err?.message || '导入文件失败')
    }
  }, [])

  const handleEmbedDocument = useCallback(async (docId: string) => {
    setEmbedding(true)
    try {
      const result = await ipcClient.invoke(IPC.KNOWLEDGE_LOCAL_EMBED, { documentId: docId }) as ApiResponse<{ count: number }>
      if (result.success) {
        toast.success(t('knowledgePage.local.embedDone', { count: result.data?.count ?? 0, defaultValue: `索引完成：${result.data?.count} 个分块` }))
        fetchLocalDocs()
      } else toast.error(result.error || '向量化失败')
    } catch (err: any) { toast.error(err.message || '向量化失败') }
    finally { setEmbedding(false) }
  }, [t])

  // ---- Init ----
  useEffect(() => { fetchDatasets() }, [fetchDatasets])
  useEffect(() => { if (tab === 'local') fetchLocalDocs() }, [tab, fetchLocalDocs])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{t('knowledgePage.title', { defaultValue: '知识库' })}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant={tab === 'enterprise' ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => setTab('enterprise')}
            >
              <Database className="size-3.5 mr-1" />
              {t('knowledgePage.tabs.enterprise', { defaultValue: '企业知识库' })}
            </Button>
            <Button
              variant={tab === 'local' ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => setTab('local')}
            >
              <Layers className="size-3.5 mr-1" />
              {t('knowledgePage.tabs.local', { defaultValue: '本地知识库' })}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'enterprise' && (
            <Badge variant="secondary" className="text-xs">{t('knowledgePage.readOnly', { defaultValue: '只读' })}</Badge>
          )}
        </div>
      </div>

      {/* Content */}
      {tab === 'enterprise' ? (
        /* =================== 企业知识库 =================== */
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-32 w-full rounded-xl" />))}
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
              <p className="text-sm">{t('knowledgePage.empty', { defaultValue: '暂无知识库' })}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {datasets.map((ds) => (
                <button key={ds.id} className="group flex flex-col rounded-xl border bg-card p-5 text-left transition-all hover:border-primary/50 hover:shadow-md cursor-pointer" onClick={() => openKbDetail(ds)}>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10"><BookOpen className="size-4 text-primary" /></div>
                    <Badge variant="secondary" className="text-xs shrink-0">{ds.type}</Badge>
                  </div>
                  <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{ds.name}</h3>
                  {ds.intro && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{ds.intro}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* =================== 本地知识库 =================== */
        <div className="flex-1 overflow-y-auto p-6">
          {/* 操作栏 */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder={searchMode === 'semantic'
                  ? t('knowledgePage.local.searchSemantic', { defaultValue: '语义搜索' })
                  : t('knowledgePage.local.searchKeyword', { defaultValue: '关键词搜索' })}
                value={localSearch}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <Button
              variant={searchMode === 'semantic' ? 'default' : 'outline'}
              size="sm" className="text-xs shrink-0"
              onClick={() => setSearchMode(searchMode === 'keyword' ? 'semantic' : 'keyword')}
            >
              <BrainCircuit className="size-3.5 mr-1" />
              {searchMode === 'keyword'
                ? t('knowledgePage.local.searchSemantic', { defaultValue: '语义' })
                : t('knowledgePage.local.searchKeyword', { defaultValue: '关键词' })}
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={handleImportFile}>
              <FileUp className="size-3.5 mr-1" />
              {t('knowledgePage.local.importFile', { defaultValue: '导入文件' })}
            </Button>
            <Button size="sm" className="text-xs" onClick={() => setShowAddDoc(true)}>
              <Plus className="size-3.5 mr-1" />
              {t('knowledgePage.local.add', { defaultValue: '添加文档' })}
            </Button>
          </div>

          {localLoading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中...
            </div>
          ) : (searchResults ?? localDocs).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <BookOpen className="mb-3 size-10 opacity-30" />
              <p className="text-sm">{t('knowledgePage.local.noDocuments', { defaultValue: '暂无本地文档，点击添加' })}</p>
            </div>
          ) : searchResults ? (
            /* 搜索结果 */
            <div className="space-y-3">
              {searchResults.map((r) => (
                <div key={r.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">#{r.chunk_index}</Badge>
                    <span className="text-xs text-muted-foreground">{r.document_title}</span>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS} components={markdownComponents}>
                      {r.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* 文档列表 */
            <div className="space-y-2">
              {localDocs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-all hover:border-primary/30">
                  <button className="flex-1 text-left min-w-0" onClick={() => handleViewChunks(doc)}>
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-primary shrink-0" />
                      <span className="text-sm font-medium truncate">{doc.title}</span>
                      {cleaningStates[doc.id] === 'cleaning' && (
                        <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400 shrink-0">
                          <Loader2 className="size-2.5 animate-spin mr-1" />
                          清洗中...
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{formatTs(doc.created_at)}</span>
                      <span>{t('knowledgePage.local.chunks', { count: doc.chunk_count, defaultValue: `${doc.chunk_count} 个分块` })}</span>
                    </div>
                  </button>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-primary" onClick={() => handleEmbedDocument(doc.id)} disabled={embedding} title={t('knowledgePage.local.embed', { defaultValue: '生成索引' })}>
                    {embedding ? <Loader2 className="size-3.5 animate-spin" /> : <BrainCircuit className="size-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => handleDeleteDoc(doc)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Enterprise: Collection Dialog */}
      <Dialog open={!!selectedKb} onOpenChange={(open) => { if (!open) closeEnterDialog() }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4 text-primary" /> {selectedKb?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedKb?.intro && <p className="-mt-2 text-xs text-muted-foreground">{selectedKb.intro}</p>}
          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {collections.loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> 加载中...</div>
            ) : collections.error ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-red-500">
                <p>{collections.error}</p>
                <Button variant="outline" size="sm" onClick={() => openKbDetail(selectedKb!)}>重试</Button>
              </div>
            ) : collections.items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无数据集</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5">
                  <span className="text-xs text-muted-foreground">共 {collections.total} 个数据集</span>
                </div>
                <div className="divide-y">
                  {collections.items.map((item) => (
                    <button key={item.id} className="w-full px-6 py-4 hover:bg-muted/30 transition-colors text-left cursor-pointer" onClick={() => openChunks(item)}>
                      <div className="flex items-center gap-2">{typeIcon(item.type)}<span className="text-sm font-medium truncate">{item.name}</span></div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">{typeLabel(item.type)}</span><span>·</span>
                        <span>{trainingTypeLabel(item.trainingType)}</span><span>·</span>
                        <span>{item.dataAmount} 条数据</span><span>·</span>
                        <span>{formatDate(item.updateTime)}</span>
                      </div>
                      {item.tags && item.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">{item.tags.map((tag) => (<Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">{tag}</Badge>))}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Enterprise: Chunks Dialog */}
      <Dialog open={!!selectedCollection} onOpenChange={(open) => { if (!open) setSelectedCollection(null) }}>
        <DialogContent className="sm:max-w-[95vw] max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">{typeIcon(selectedCollection?.type || '')}{selectedCollection?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {chunks.loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> 加载中...</div>
            ) : chunks.error ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-red-500"><p>{chunks.error}</p><Button variant="outline" size="sm" onClick={() => openChunks(selectedCollection!)}>重试</Button></div>
            ) : chunks.items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无分块数据</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5"><span className="text-xs text-muted-foreground">共 {chunks.total} 条分块</span></div>
                <div className="divide-y">
                  {chunks.items.map((chunk) => (
                    <div key={chunk.id} className="px-6 py-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">#{chunk.chunkIndex}</Badge>
                        <span className="text-xs text-muted-foreground truncate">{chunk.sourceName}</span>
                      </div>
                      {chunk.content && (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                          <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS} components={markdownComponents}>{chunk.content}</ReactMarkdown>
                        </div>
                      )}
                      {chunk.answer && (
                        <div className="mt-2 rounded bg-muted/50 px-3 py-2 prose prose-sm dark:prose-invert max-w-none">
                          <span className="text-xs text-muted-foreground">答案：</span>
                          <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS} components={markdownComponents}>{chunk.answer}</ReactMarkdown>
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

      {/* Local: View Chunks Dialog */}
      <Dialog open={showViewChunks} onOpenChange={(open) => { if (!open) setShowViewChunks(false) }}>
        <DialogContent className="sm:max-w-[95vw] max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-primary" /> {viewDocTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {viewDocChunks.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无分块数据</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5">
                  <span className="text-xs text-muted-foreground">共 {viewDocChunks.length} 个分块</span>
                </div>
                <div className="divide-y">
                  {viewDocChunks.map((c) => (
                    <div key={c.id} className="px-6 py-4">
                      <Badge variant="secondary" className="text-xs px-1.5 py-0 mb-2">#{c.chunk_index}</Badge>
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                        <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS} components={markdownComponents}>{c.content}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Local: Add Document Dialog */}
      <Dialog open={showAddDoc} onOpenChange={(open) => { if (!open) { setShowAddDoc(false); setNewTitle(''); setNewContent('') } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{t('knowledgePage.local.add', { defaultValue: '添加文档' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{t('knowledgePage.local.title', { defaultValue: '标题' })}</label>
              <Input className="mt-1" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('knowledgePage.local.content', { defaultValue: '内容（支持 Markdown）' })}</label>
              <Textarea className="mt-1 min-h-40" value={newContent} onChange={(e) => setNewContent(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowAddDoc(false); setNewTitle(''); setNewContent('') }}>
                {t('knowledgePage.local.cancel', { defaultValue: '取消' })}
              </Button>
              <Button size="sm" onClick={handleCreateDoc} disabled={saving || !newTitle.trim() || !newContent.trim()}>
                {saving && <Loader2 className="size-3.5 mr-1 animate-spin" />}
                {t('knowledgePage.local.save', { defaultValue: '保存' })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
