import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ipcStorage } from '@renderer/lib/ipc/ipc-storage'

interface KnowledgeState {
  selectedDatasetIds: string[]
  toggleDataset: (id: string) => void
  isDatasetSelected: (id: string) => boolean
  setSelectedDatasets: (ids: string[]) => void
}

export const useKnowledgeStore = create<KnowledgeState>()(
  persist(
    (set, get) => ({
      selectedDatasetIds: [],

      toggleDataset: (id) => {
        const current = get().selectedDatasetIds
        const next = current.includes(id)
          ? current.filter((i) => i !== id)
          : [...current, id]
        set({ selectedDatasetIds: next })
      },

      isDatasetSelected: (id) => get().selectedDatasetIds.includes(id),

      setSelectedDatasets: (ids) => set({ selectedDatasetIds: ids })
    }),
    {
      name: 'knowledge-store',
      storage: createJSONStorage(() => ipcStorage),
      partialize: (state) => ({ selectedDatasetIds: state.selectedDatasetIds })
    }
  )
)
