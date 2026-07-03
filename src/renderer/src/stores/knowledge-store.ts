import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ipcStorage } from '@renderer/lib/ipc/ipc-storage'

interface KnowledgeState {
  selectedDatasetIds: string[]
  localKbEnabled: boolean
  datasetNames: Record<string, string>
  toggleDataset: (id: string) => void
  isDatasetSelected: (id: string) => boolean
  setSelectedDatasets: (ids: string[]) => void
  setLocalKbEnabled: (enabled: boolean) => void
  setDatasetNames: (names: Record<string, string>) => void
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

      setDatasetNames: (names) => set({ datasetNames: names })
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
