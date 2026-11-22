// BP助手的状态：当前BP、撤销/重做历史。刷新页面后保留当前BP。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { newDraft, type DraftState, type Mode, type Slot } from '../engine/draft.ts';

interface BpState {
  draft: DraftState;
  past: DraftState[];
  future: DraftState[];
  /** 最近一次填入的选人槽位，用于“修改刚选英雄的分路” */
  lastPick: Slot | null;
  commit: (next: DraftState, placed?: Slot | null) => void;
  undo: () => void;
  redo: () => void;
  reset: (mode: Mode, banPerSide: number) => void;
  setCursor: (slot: Slot | null) => void;
}

const LIMIT = 100;

export const useBp = create<BpState>()(
  persist(
    (set) => ({
      draft: newDraft('ranked'),
      past: [],
      future: [],
      lastPick: null,
      commit: (next, placed) =>
        set((s) => ({
          draft: next,
          past: [...s.past.slice(-LIMIT + 1), { ...s.draft, cursor: null }],
          future: [],
          lastPick: placed === undefined ? s.lastPick : placed?.kind === 'pick' ? placed : s.lastPick,
        })),
      undo: () =>
        set((s) => {
          const prev = s.past[s.past.length - 1];
          if (!prev) return s;
          return { draft: prev, past: s.past.slice(0, -1), future: [{ ...s.draft, cursor: null }, ...s.future], lastPick: null };
        }),
      redo: () =>
        set((s) => {
          const next = s.future[0];
          if (!next) return s;
          return { draft: next, past: [...s.past, { ...s.draft, cursor: null }], future: s.future.slice(1), lastPick: null };
        }),
      reset: (mode, banPerSide) => set((s) => ({ draft: newDraft(mode, banPerSide), past: [...s.past.slice(-LIMIT + 1), { ...s.draft, cursor: null }], future: [], lastPick: null })),
      // 移动光标不进入历史
      setCursor: (slot) => set((s) => ({ draft: { ...s.draft, cursor: slot } })),
    }),
    { name: 'hok-bp-draft', version: 1, partialize: (s) => ({ draft: s.draft }) },
  ),
);
