// 数据加载：启动时拉取一次数据包，构建关系索引和推荐引擎。
import { create } from 'zustand';
import type { Bundle, HeroData, TagDef } from '../types.ts';
import { buildRelations } from '../engine/relations.ts';
import { buildMeta, buildResp, type Engine } from '../engine/recommend.ts';

interface DataState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  engine: Engine | null;
  load: () => Promise<void>;
}

export const useData = create<DataState>((set, get) => ({
  status: 'loading',
  error: null,
  engine: null,
  load: async () => {
    if (get().engine) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/bundle.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`数据包加载失败（HTTP ${res.status}）`);
      const bundle = (await res.json()) as Bundle;
      set({ status: 'ready', engine: makeEngine(bundle) });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },
}));

export function makeEngine(bundle: Bundle): Engine {
  const tagMap = new Map(bundle.tags.map((t) => [t.id, t]));
  const rel = buildRelations(bundle, (id) => tagMap.get(id)?.name ?? id);
  return { bundle, byId: new Map(bundle.heroes.map((h) => [h.id, h])), rel, ...buildMeta(bundle), resp: buildResp(bundle), model: bundle.model ?? null };
}

/** 组件内使用：数据未就绪时页面不会渲染，所以这里可以断言非空 */
export function useEngine(): Engine {
  return useData((s) => s.engine)!;
}

export function useTagMap(): Map<string, TagDef> {
  const engine = useEngine();
  // 标签表很小，直接每次构造也可以；这里挂在 bundle 上缓存
  const b = engine.bundle as Bundle & { __tagMap?: Map<string, TagDef> };
  if (!b.__tagMap) b.__tagMap = new Map(b.tags.map((t) => [t.id, t]));
  return b.__tagMap;
}

export const heroName = (engine: Engine, id: number) => engine.byId.get(id)?.name ?? `#${id}`;

/** 数据新鲜度：超过14天提示，超过30天强提示 */
export function freshness(generatedAt: string, now = Date.now()): { days: number; level: 'fresh' | 'stale' | 'old' } {
  const days = Math.floor((now - new Date(generatedAt).getTime()) / 86400_000);
  return { days, level: days > 30 ? 'old' : days > 14 ? 'stale' : 'fresh' };
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '未知');

export const sortByName = (a: HeroData, b: HeroData) => a.pinyin.localeCompare(b.pinyin);
