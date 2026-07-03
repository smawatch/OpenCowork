import type { IPCClient } from '@renderer/lib/tools/tool-types'
import { IPC } from '@renderer/lib/ipc/channels'

export type SystemTag = '企业' | '个人' | '外部' | '共享' | '公开' | '官方' | '只读'

export const SYSTEM_TAG_CONFIG: Record<SystemTag, { bg: string; color: string }> = {
  企业: { bg: '#EEF6FF', color: '#2563EB' },
  个人: { bg: '#F0FDF4', color: '#16A34A' },
  外部: { bg: '#FFF4E5', color: '#D97706' },
  共享: { bg: '#ECFDF5', color: '#059669' },
  公开: { bg: '#F5F3FF', color: '#7C3AED' },
  官方: { bg: '#FEF2F2', color: '#DC2626' },
  只读: { bg: '#F3F4F6', color: '#6B7280' }
}

export const SYSTEM_TAG_FILTERS: (SystemTag | '全部')[] = ['全部', '个人', '企业']

export interface DatasetItem {
  id: string
  name: string
  intro?: string
  type?: string
  /** 系统标签：企业/外部/共享/公开/官方/只读 */
  systemTag?: SystemTag
  /** 业务分类标签 */
  tags?: string[]
  /** 创建人姓名 */
  creator?: string
  /** 创建人头像 URL */
  creatorAvatar?: string
  /** 文档/集合数量 */
  docCount?: number
  /** 最后更新时间 ISO string */
  updateTime?: string
}

export interface CollectionItem {
  id: string
  name: string
  type: string
  trainingType: string
  dataAmount: number
  trainingAmount?: number
  tags: string[]
  updateTime: string
  /** 父级目录 ID，null/undefined 表示根目录 */
  parentId?: string | null
  /** 子节点（客户端构建树结构时使用） */
  children?: CollectionItem[]
}

export interface CreateDatasetResult {
  id: string
  name: string
  intro?: string
}

export interface ImportFileResult {
  collectionId: string
  results: {
    insertLen: number
  }
}

export interface CreateTextResult {
  collectionId: string
  results: {
    insertLen: number
  }
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
  code?: string
}

export class KbApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'KbApiError'
    this.code = code
  }
}

function checkAuthError(result: ApiResponse<unknown>): void {
  if (result.code === 'UNAUTHORIZED') {
    throw new KbApiError('Unauthorized', 'UNAUTHORIZED')
  }
}

export async function createDataset(
  ipc: IPCClient,
  params: { name: string; intro?: string; tags?: string[] }
): Promise<ApiResponse<CreateDatasetResult>> {
  const result = (await ipc.invoke(
    IPC.KNOWLEDGE_PERSONAL_CREATE_DATASET,
    params
  )) as ApiResponse<CreateDatasetResult>
  checkAuthError(result)
  return result
}

export async function importFileToDataset(
  ipc: IPCClient,
  params: {
    datasetId: string
    fileName: string
    fileBuffer: ArrayBuffer
    trainingType?: string
    parentId?: string
  }
): Promise<ApiResponse<ImportFileResult>> {
  const result = (await ipc.invoke(
    IPC.KNOWLEDGE_PERSONAL_IMPORT_FILE,
    params
  )) as ApiResponse<ImportFileResult>
  checkAuthError(result)
  return result
}

export async function createTextCollection(
  ipc: IPCClient,
  params: {
    datasetId: string
    name: string
    text: string
    trainingType?: string
    qaPrompt?: string
    chunkSettingMode?: string
    parentId?: string
    metadata?: Record<string, unknown>
  }
): Promise<ApiResponse<CreateTextResult>> {
  const result = (await ipc.invoke(
    IPC.KNOWLEDGE_PERSONAL_CREATE_TEXT_COLLECTION,
    params
  )) as ApiResponse<CreateTextResult>
  checkAuthError(result)
  return result
}

export interface CreateFolderParams {
  datasetId: string
  name: string
  parentId?: string
  metadata?: Record<string, unknown>
}

export interface CreateFolderResult {
  id: string
}

export async function createFolder(
  ipc: IPCClient,
  params: CreateFolderParams
): Promise<ApiResponse<CreateFolderResult>> {
  const result = (await ipc.invoke(
    IPC.KNOWLEDGE_PERSONAL_CREATE_FOLDER,
    params
  )) as ApiResponse<CreateFolderResult>
  checkAuthError(result)
  return result
}

export async function listDatasets(ipc: IPCClient): Promise<ApiResponse<DatasetItem[]>> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_PERSONAL_LIST_DATASETS)) as ApiResponse<
    DatasetItem[]
  >
  checkAuthError(result)
  return result
}

export interface UpdateDatasetParams {
  id: string
  name?: string
  intro?: string
  tags?: string[]
}

export async function updateDataset(
  ipc: IPCClient,
  params: UpdateDatasetParams
): Promise<ApiResponse<void>> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_PERSONAL_UPDATE_DATASET, params)) as ApiResponse<void>
  checkAuthError(result)
  return result
}

export async function deleteDataset(ipc: IPCClient, id: string): Promise<ApiResponse<void>> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_PERSONAL_DELETE_DATASET, {
    id
  })) as ApiResponse<void>
  checkAuthError(result)
  return result
}

export interface ChunkItem {
  id: string
  content: string
  answer: string
  chunkIndex: number
  sourceName: string
}

export async function listChunks(
  ipc: IPCClient,
  collectionId: string
): Promise<ApiResponse<ChunkItem[]> & { total?: number }> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_LIST_CHUNKS, {
    collectionId
  })) as ApiResponse<ChunkItem[]> & { total?: number }
  checkAuthError(result)
  return result
}

export async function deleteCollections(
  ipc: IPCClient,
  params: { datasetId: string; collectionIds: string[] }
): Promise<ApiResponse<void>> {
  const result = (await ipc.invoke(
    IPC.KNOWLEDGE_PERSONAL_DELETE_COLLECTIONS,
    params
  )) as ApiResponse<void>
  checkAuthError(result)
  return result
}

export async function listCollections(
  ipc: IPCClient,
  datasetId: string,
  parentId?: string
): Promise<ApiResponse<CollectionItem[]>> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_LIST_COLLECTIONS, {
    kbId: datasetId,
    parentId: parentId || undefined
  })) as ApiResponse<CollectionItem[]>
  checkAuthError(result)
  return result
}

export interface StoredFile {
  collectionId: string
  fileName: string
}

export async function downloadFile(
  ipc: IPCClient,
  params: { datasetId: string; collectionId: string; fileName: string }
): Promise<ApiResponse<{ path: string }>> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_PERSONAL_DOWNLOAD_FILE, params)) as ApiResponse<{
    path: string
  }>
  return result
}

export async function listStoredFiles(
  ipc: IPCClient,
  datasetId: string
): Promise<ApiResponse<StoredFile[]>> {
  const result = (await ipc.invoke(IPC.KNOWLEDGE_PERSONAL_LIST_FILES, {
    datasetId
  })) as ApiResponse<StoredFile[]>
  return result
}
