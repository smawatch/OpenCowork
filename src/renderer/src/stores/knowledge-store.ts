import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ipcStorage } from '@renderer/lib/ipc/ipc-storage'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'

interface KnowledgeState {
  selectedDatasetIds: string[]
  localKbEnabled: boolean
  datasetNames: Record<string, string>
  toggleDataset: (id: string) => void
  isDatasetSelected: (id: string) => boolean
  setSelectedDatasets: (ids: string[]) => void
  setLocalKbEnabled: (enabled: boolean) => void
  setDatasetNames: (names: Record<string, string>) => void
  initAutoSelectDatasets: () => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>()(
  persist(
    (set, get) => ({
      selectedDatasetIds: [],
      localKbEnabled: false,
      datasetNames: {},

      toggleDataset: (id) => {
        const current = get().selectedDatasetIds
        const next = current.includes(id)
          ? current.filter((i) => i !== id)
          : [...current, id]
        set({ selectedDatasetIds: next })
      },

      isDatasetSelected: (id) => get().selectedDatasetIds.includes(id),

      setSelectedDatasets: (ids) => set({ selectedDatasetIds: ids }),

      setLocalKbEnabled: (enabled) => set({ localKbEnabled: enabled }),

      setDatasetNames: (names) => set({ datasetNames: names }),

      initAutoSelectDatasets: async () => {
        // 如果已经有选中的知识库，不再自动选中
        if (get().selectedDatasetIds.length > 0) {
          console.log('[KnowledgeStore] 已有选中的知识库，跳过自动选中:', get().selectedDatasetIds)
          return
        }

        try {
          console.log('[KnowledgeStore] 开始自动选中企业/部门知识库...')
          // 获取企业知识库和个人知识库
          const [enterpriseR, personalR] = await Promise.all([
            ipcClient.invoke(IPC.KNOWLEDGE_LIST_DATASETS).catch(() => null) as Promise<any>,
            ipcClient.invoke(IPC.KNOWLEDGE_PERSONAL_LIST_DATASETS).catch(() => null) as Promise<any>
          ])

          console.log('[KnowledgeStore] 企业知识库响应:', enterpriseR)
          console.log('[KnowledgeStore] 个人知识库响应:', personalR)

          const enterprise = enterpriseR?.success ? enterpriseR.data ?? [] : []
          const personal = personalR?.success ? personalR.data ?? [] : []

          console.log('[KnowledgeStore] 企业知识库数量:', enterprise.length)
          console.log('[KnowledgeStore] 个人知识库数量:', personal.length)

          // 企业知识库全部选中
          const enterpriseIds = enterprise.map((ds: any) => ds.id)
          // 部门知识库（source === 'department'）全部选中
          const departmentIds = personal
            .filter((ds: any) => ds.source === 'department')
            .map((ds: any) => ds.id)

          console.log('[KnowledgeStore] 企业知识库 IDs:', enterpriseIds)
          console.log('[KnowledgeStore] 部门知识库 IDs:', departmentIds)

          const autoSelectedIds = [...enterpriseIds, ...departmentIds]

          console.log('[KnowledgeStore] 自动选中的 IDs:', autoSelectedIds)

          if (autoSelectedIds.length > 0) {
            // 同时设置 datasetNames
            const names: Record<string, string> = {}
            for (const ds of [...enterprise, ...personal]) {
              names[ds.id] = ds.name
            }
            set({ selectedDatasetIds: autoSelectedIds, datasetNames: names })
            console.log('[KnowledgeStore] 已设置自动选中的知识库')
          }
        } catch (error) {
          console.error('Failed to init auto select datasets:', error)
        }
      }
    }),
    {
      name: 'knowledge-store',
      storage: createJSONStorage(() => ipcStorage),
      partialize: (state) => ({
        selectedDatasetIds: state.selectedDatasetIds,
        localKbEnabled: state.localKbEnabled
      })
    }
  )
)
