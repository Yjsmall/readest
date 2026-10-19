import { create } from 'zustand';

export type VocabularyTask = 'saving' | 'translating' | 'save-error' | 'translation-error';

interface ContextVocabularyState {
  selectedId: string | null;
  tasks: Record<string, VocabularyTask>;
  select: (id: string) => void;
  setTask: (id: string, task?: VocabularyTask) => void;
}

export const useContextVocabularyStore = create<ContextVocabularyState>((set) => ({
  selectedId: null,
  tasks: {},
  select: (id) => set({ selectedId: id }),
  setTask: (id, task) =>
    set((state) => {
      const tasks = { ...state.tasks };
      if (task) tasks[id] = task;
      else delete tasks[id];
      return { tasks };
    }),
}));
