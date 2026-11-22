// 关系图谱页面（/graph）。两个模式页内切换，模式与状态都写在 URL 参数里：
//   单英雄图谱：/graph?hero=ID[&kind=official|rule|kpl][&scene=对线][&n=10]
//   阵容对阵：  /graph?mode=team&blue=1,2,3&red=4,5[&scene=团战]
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Segmented } from '../components/ui.tsx';
import { EgoMode, type ParamPatch } from '../components/graph/EgoMode.tsx';
import { TeamMode } from '../components/graph/TeamMode.tsx';

type Mode = 'hero' | 'team';

export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'team' ? 'team' : 'hero';

  /** 合并更新 URL 参数；push=true 时写入浏览器历史（切换中心英雄、切换模式），否则替换当前记录 */
  const update = useCallback(
    (patch: ParamPatch, push = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: !push },
      ),
    [setParams],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold">关系图谱</h1>
          <p className="mt-0.5 text-[12.5px] text-mute">
            关系来自官方英雄页面说明、技能原文的规则推导和职业赛同队共现，只画已核实的证据；线的粗细是计分权重，不是胜率。
          </p>
        </div>
        <Segmented<Mode>
          value={mode}
          options={[
            { value: 'hero', label: '单英雄图谱', title: '以一个英雄为中心看它的克制、被克制与配合' },
            { value: 'team', label: '阵容对阵', title: '看双方阵容之间的克制和各自队内的配合' },
          ]}
          onChange={(m) => update({ mode: m === 'team' ? 'team' : null }, true)}
        />
      </div>
      {mode === 'team' ? <TeamMode params={params} update={update} /> : <EgoMode params={params} update={update} />}
    </div>
  );
}
