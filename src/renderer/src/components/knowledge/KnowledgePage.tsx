import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  Database,
  FileText,
  Layers,
  Link,
  Loader2,
  Pencil,
  RefreshCw
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Badge } from '@renderer/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useAuthStore } from '@renderer/stores/auth-store'

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

interface ApiResponse<T> {
  success: boolean
  data: T
  total?: number
  error?: string
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
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return iso
  }
}

export function KnowledgePage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [datasets, setDatasets] = useState<DatasetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedKb, setSelectedKb] = useState<DatasetItem | null>(null)
  const [collections, setCollections] = useState<{
    loading: boolean
    total: number
    items: CollectionItem[]
    error: string | null
  }>({ loading: false, total: 0, items: [], error: null })

  const [selectedCollection, setSelectedCollection] = useState<CollectionItem | null>(null)
  const [chunks, setChunks] = useState<{
    loading: boolean
    total: number
    items: ChunkItem[]
    error: string | null
  }>({ loading: false, total: 0, items: [], error: null })

  const handleAuthError = useCallback((result: { code?: string }) => {
    if (result.code === 'UNAUTHORIZED') {
      useAuthStore.getState().logout()
    }
  }, [])

  const fetchDatasets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_DATASETS)) as ApiResponse<
        DatasetItem[]
      > & { code?: string }
      handleAuthError(result)
      if (!result.success) {
        setError(result.error || '获取知识库列表失败')
        return
      }
      setDatasets(result.data ?? [])
    } catch (err: any) {
      setError(err.message || '网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  const openKbDetail = useCallback(async (kb: DatasetItem) => {
    setSelectedKb(kb)
    setCollections({ loading: true, total: 0, items: [], error: null })
    try {
      const result = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_COLLECTIONS, {
        kbId: kb.id
      })) as ApiResponse<CollectionItem[]> & { code?: string }
      handleAuthError(result)
      if (!result.success) {
        setCollections({
          loading: false,
          total: 0,
          items: [],
          error: result.error || '获取数据集失败'
        })
        return
      }
      setCollections({
        loading: false,
        total: result.total ?? result.data?.length ?? 0,
        items: result.data ?? [],
        error: null
      })
    } catch (err: any) {
      setCollections({
        loading: false,
        total: 0,
        items: [],
        error: err.message || '网络错误'
      })
    }
  }, [])

  const openChunks = useCallback(async (collection: CollectionItem) => {
    setSelectedCollection(collection)
    setChunks({ loading: true, total: 0, items: [], error: null })
    try {
      const result = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_CHUNKS, {
        collectionId: collection.id
      })) as ApiResponse<ChunkItem[]> & { code?: string }
      handleAuthError(result)
      if (!result.success) {
        setChunks({
          loading: false,
          total: 0,
          items: [],
          error: result.error || '获取分块失败'
        })
        return
      }
      setChunks({
        loading: false,
        total: result.total ?? result.data?.length ?? 0,
        items: result.data ?? [],
        error: null
      })
    } catch (err: any) {
      setChunks({ loading: false, total: 0, items: [], error: err.message || '网络错误' })
    }
  }, [])

  const closeDialog = useCallback(() => {
    setSelectedKb(null)
    setCollections({ loading: false, total: 0, items: [], error: null })
    setSelectedCollection(null)
    setChunks({ loading: false, total: 0, items: [], error: null })
  }, [])

  useEffect(() => {
    fetchDatasets()
  }, [fetchDatasets])

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">
            {t('knowledgePage.title', { defaultValue: '知识库' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('knowledgePage.subtitle', { defaultValue: '浏览和管理你的知识库' })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDatasets} disabled={loading}>
          <RefreshCw className={`mr-1 size-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
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
              <RefreshCw className="mr-1 size-3" />
              重试
            </Button>
          </div>
        ) : datasets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <BookOpen className="mb-3 size-10 opacity-30" />
            <p className="text-sm">
              {t('knowledgePage.empty', { defaultValue: '暂无知识库' })}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {datasets.map((ds) => (
              <button
                key={ds.id}
                className="group flex flex-col rounded-xl border bg-card p-5 text-left transition-all hover:border-primary/50 hover:shadow-md cursor-pointer"
                onClick={() => openKbDetail(ds)}
              >
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                    <BookOpen className="size-4 text-primary" />
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {ds.type}
                  </Badge>
                </div>
                <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                  {ds.name}
                </h3>
                {ds.intro && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{ds.intro}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Collection Dialog */}
      <Dialog open={!!selectedKb} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4 text-primary" />
              {selectedKb?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedKb?.intro && (
            <p className="-mt-2 text-xs text-muted-foreground">{selectedKb.intro}</p>
          )}

          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {collections.loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载中...
              </div>
            ) : collections.error ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-red-500">
                <p>{collections.error}</p>
                <Button variant="outline" size="sm" onClick={() => openKbDetail(selectedKb!)}>
                  重试
                </Button>
              </div>
            ) : collections.items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无数据集</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    共 {collections.total} 个数据集
                  </span>
                </div>
                <div className="divide-y">
                  {collections.items.map((item) => (
                    <button
                      key={item.id}
                      className="w-full px-6 py-4 hover:bg-muted/30 transition-colors text-left cursor-pointer"
                      onClick={() => openChunks(item)}
                    >
                      <div className="flex items-center gap-2">
                        {typeIcon(item.type)}
                        <span className="text-sm font-medium truncate">{item.name}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          {typeLabel(item.type)}
                        </span>
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
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Chunks Dialog */}
      <Dialog open={!!selectedCollection} onOpenChange={(open) => { if (!open) setSelectedCollection(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {typeIcon(selectedCollection?.type || '')}
              {selectedCollection?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 -mb-6">
            {chunks.loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载中...
              </div>
            ) : chunks.error ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-red-500">
                <p>{chunks.error}</p>
                <Button variant="outline" size="sm" onClick={() => openChunks(selectedCollection!)}>
                  重试
                </Button>
              </div>
            ) : chunks.items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">暂无分块数据</div>
            ) : (
              <div>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    共 {chunks.total} 条分块
                  </span>
                </div>
                <div className="divide-y">
                  {chunks.items.map((chunk) => (
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
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
                      )}
                      {chunk.answer && (
                        <div className="mt-2 rounded bg-muted/50 px-3 py-2">
                          <span className="text-xs text-muted-foreground">答案：</span>
                          <p className="text-sm mt-0.5">{chunk.answer}</p>
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
