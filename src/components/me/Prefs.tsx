import { useUser } from '../../lib/userStore.ts';
import { Segmented } from '../ui.tsx';
import { MODE_INFO, type Mode, type Side } from '../../engine/draft.ts';
import { LANES, LANE_NAME, type Lane } from '../../types.ts';

export function Prefs() {
  const prefs = useUser((s) => s.prefs);
  const set = useUser((s) => s.setPrefs);
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-4">
      <div className="w-28 shrink-0 text-[13px] text-sub">{label}</div>
      {children}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <Row label="我方阵营">
        <Segmented<Side> value={prefs.mySide} onChange={(v) => set({ mySide: v })} options={[{ value: 'blue', label: '蓝方' }, { value: 'red', label: '红方' }]} />
      </Row>
      <Row label="我的位置">
        <Segmented<number> value={prefs.myLane ?? 0} onChange={(v) => set({ myLane: v === 0 ? null : (v as Lane) })} options={[{ value: 0, label: '不指定' }, ...LANES.map((l) => ({ value: l as number, label: LANE_NAME[l] }))]} />
      </Row>
      <Row label="默认模式">
        <Segmented<Mode> value={prefs.mode} onChange={(v) => set({ mode: v })} options={(Object.keys(MODE_INFO) as Mode[]).map((m) => ({ value: m, label: MODE_INFO[m].name, title: MODE_INFO[m].desc }))} />
      </Row>
      <Row label="每方禁用位数量">
        <Segmented<number> value={prefs.banPerSide} onChange={(v) => set({ banPerSide: v })} options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <p className="text-[12px] text-mute">修改后自动保存。{MODE_INFO[prefs.mode].desc}。</p>
    </div>
  );
}
