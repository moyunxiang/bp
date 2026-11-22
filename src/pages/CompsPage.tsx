// 战术阵容库：战术体系、职业赛阵容、我的阵容、阵容对比。当前标签页与选中的阵容写在 URL 参数里。
import { useSearchParams } from 'react-router-dom';
import { useUser } from '../lib/userStore.ts';
import { useEngine } from '../lib/data.ts';
import { Segmented } from '../components/ui.tsx';
import { ArchetypesTab } from '../components/comps/ArchetypesTab.tsx';
import { ProTab } from '../components/comps/ProTab.tsx';
import { MineTab } from '../components/comps/MineTab.tsx';
import { CompareTab } from '../components/comps/CompareTab.tsx';
import type { ParamPatch, TabKey } from '../components/comps/shared.tsx';

const TABS: { value: TabKey; label: string }[] = [
  { value: 'archetypes', label: '战术体系' },
  { value: 'pro', label: '职业赛阵容' },
  { value: 'mine', label: '我的阵容' },
  { value: 'compare', label: '阵容对比' },
];

export function CompsPage() {
  const [params, setParams] = useSearchParams();
  const { bundle } = useEngine();
  const customCount = useUser((s) => s.customComps.length);
  const raw = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.value === raw) ? (raw as TabKey) : 'archetypes';

  const update = (patch: ParamPatch, replace = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === '') next.delete(k);
          else next.set(k, v);
        }
        if (!next.get('tab')) next.set('tab', tab);
        return next;
      },
      { replace },
    );

  const labels: Record<TabKey, string> = {
    archetypes: `战术体系（${bundle.archetypes.length}）`,
    pro: bundle.comps ? `职业赛阵容（${bundle.comps.lineups.length + bundle.comps.trios.length}）` : '职业赛阵容',
    mine: `我的阵容（${customCount}）`,
    compare: '阵容对比',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h1 className="text-[18px] font-semibold text-ink">战术阵容库</h1>
        <Segmented value={tab} onChange={(v) => update({ tab: v })} options={TABS.map((t) => ({ value: t.value, label: labels[t.value] }))} />
        <span className="ml-auto text-[12px] text-dim">阵容分析只按官方职业、已核实机制标签和关系证据计算，不含胜率或强度评价</span>
      </div>
      {tab === 'archetypes' && <ArchetypesTab archId={params.get('arch')} onSelect={(id) => update({ arch: id }, true)} />}
      {tab === 'pro' && <ProTab params={params} update={update} />}
      {tab === 'mine' && <MineTab params={params} update={update} />}
      {tab === 'compare' && <CompareTab params={params} update={update} />}
    </div>
  );
}
