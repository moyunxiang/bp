// 图谱右侧面板用到的小组件：关系详情卡、计分权重说明、关系列表行、可展开列表。
import { useState, type ReactNode } from 'react';
import { W, type Relation } from '../../engine/relations.ts';
import type { HeroData } from '../../types.ts';
import { KindBadges, RelationCard } from '../Evidence.tsx';
import { HeroAvatar } from '../ui.tsx';
import { fmtWeight, sameRel } from './shared.ts';

/** 计分权重是什么、从哪来。数字取自引擎常量，不写死 */
export function WeightNote({ weight }: { weight: number }) {
  return (
    <p className="text-[12px] leading-relaxed text-mute">
      <span className="text-sub">计分权重 {fmtWeight(weight)}</span>
      ：由已核实证据按类型累加——官方说明{W.official}（双方官方页面互相印证再加{W.officialCorroborated}），机制推导合计最多{W.ruleCap}，职业赛同队共现最多{W.kplCap}，已核实解说{W.commentary}；总计不超过{W.totalCap}。它只用于排序和推荐，不是胜率。
    </p>
  );
}

export function RelationDetail({ relation, perspective, onClose, actions }: { relation: Relation; perspective?: number; onClose: () => void; actions?: ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="panel-title">关系详情</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          关闭
        </button>
      </div>
      <RelationCard relation={relation} perspective={perspective} />
      <div className="mt-3">
        <WeightNote weight={relation.weight} />
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

/** 一行关系：头像、名字、证据类型、权重 */
export function RelationRow({
  relation,
  heroes,
  verb,
  verbClass,
  selected,
  onClick,
}: {
  relation: Relation;
  /** 只给一个英雄时只显示该英雄；给两个时显示“X 动词 Y” */
  heroes: [HeroData] | [HeroData, HeroData];
  verb?: string;
  verbClass?: string;
  selected?: Relation | null;
  onClick: () => void;
}) {
  const active = sameRel(relation, selected);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-panel3 text-ink' : 'text-sub hover:bg-panel2 hover:text-ink'}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <HeroAvatar hero={heroes[0]} size={22} />
        <span className="truncate">{heroes[0].name}</span>
      </span>
      {heroes.length === 2 && (
        <>
          <span className={`shrink-0 text-[12px] ${verbClass ?? 'text-mute'}`}>{verb}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <HeroAvatar hero={heroes[1]} size={22} />
            <span className="truncate">{heroes[1].name}</span>
          </span>
        </>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <KindBadges relation={relation} />
        <span className="w-8 text-right text-[12px] text-mute" title="计分权重，不是胜率">
          {fmtWeight(relation.weight)}
        </span>
      </span>
    </button>
  );
}

/** 默认只显示前 initial 个，其余点“显示全部” */
export function ShowMore<T>({ items, initial, render, empty }: { items: T[]; initial: number; render: (item: T) => ReactNode; empty?: ReactNode }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <>{empty ?? null}</>;
  const list = all ? items : items.slice(0, initial);
  return (
    <div>
      <div className="space-y-0.5">{list.map(render)}</div>
      {items.length > initial && (
        <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setAll((v) => !v)}>
          {all ? '收起' : `显示全部（${items.length}）`}
        </button>
      )}
    </div>
  );
}
