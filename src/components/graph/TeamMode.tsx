// 关系图谱 · 阵容对阵模式（/graph?mode=team&blue=1,2,3&red=4,5）。
// URL 参数：blue / red 为逗号分隔的英雄ID（每方最多5个，不能重复，同组形态互斥）；scene 场景。
import { useMemo, useState } from 'react';
import type { Relation } from '../../engine/relations.ts';
import { sameGroup } from '../../engine/relations.ts';
import { useEngine } from '../../lib/data.ts';
import type { Engine } from '../../engine/recommend.ts';
import type { HeroData } from '../../types.ts';
import { TeamGraph } from '../TeamGraph.tsx';
import { Empty, HeroAvatar, Segmented } from '../ui.tsx';
import type { UpdateParams } from './EgoMode.tsx';
import { HeroPicker } from './HeroPicker.tsx';
import { RelationDetail, RelationRow, ShowMore } from './RelationPanel.tsx';
import { teamRelations } from './teamRelations.ts';
import { parseScene, SCENE_OPTIONS } from './shared.ts';

type Side = 'blue' | 'red';
const TEAM_MAX = 5;
const SIDE_NAME: Record<Side, string> = { blue: '蓝方', red: '红方' };

interface Parsed {
  blue: HeroData[];
  red: HeroData[];
  /** URL 中被忽略的条目说明 */
  ignored: string[];
}

/** 解析阵容参数：忽略不存在的ID、重复英雄、同组形态与超出5个的部分（蓝方优先） */
function parseTeams(engine: Engine, blueStr: string | null, redStr: string | null): Parsed {
  const used: HeroData[] = [];
  const ignored: string[] = [];
  const parse = (s: string | null, side: Side) => {
    const out: HeroData[] = [];
    for (const raw of (s ?? '').split(',')) {
      const t = raw.trim();
      if (!t) continue;
      const h = /^\d+$/.test(t) ? engine.byId.get(Number(t)) : undefined;
      if (!h) {
        ignored.push(`不存在的英雄ID“${t}”`);
        continue;
      }
      const clash = used.find((u) => u.id === h.id || sameGroup(u, h));
      if (clash) {
        ignored.push(clash.id === h.id ? `重复的${h.name}` : `${h.name}（与${clash.name}为同一英雄的不同形态）`);
        continue;
      }
      if (out.length >= TEAM_MAX) {
        ignored.push(`${SIDE_NAME[side]}超出5个的${h.name}`);
        continue;
      }
      used.push(h);
      out.push(h);
    }
    return out;
  };
  const blue = parse(blueStr, 'blue');
  const red = parse(redStr, 'red');
  return { blue, red, ignored };
}

export function TeamMode({ params, update }: { params: URLSearchParams; update: UpdateParams }) {
  const engine = useEngine();
  const blueStr = params.get('blue');
  const redStr = params.get('red');
  const { blue, red, ignored } = useMemo(() => parseTeams(engine, blueStr, redStr), [engine, blueStr, redStr]);
  const scene = parseScene(params.get('scene'));
  const [selected, setSelected] = useState<Relation | null>(null);
  const [picking, setPicking] = useState<{ side: Side; index: number } | null>(null);

  const setTeams = (b: HeroData[], r: HeroData[]) => {
    update({ blue: b.length ? b.map((h) => h.id).join(',') : null, red: r.length ? r.map((h) => h.id).join(',') : null });
    // 选中的关系如果不再属于当前阵容，清除
    if (selected) {
      const ids = new Set([...b, ...r].map((h) => h.id));
      if (!ids.has(selected.a) || !ids.has(selected.b)) setSelected(null);
    }
  };

  const teamOf = (side: Side) => (side === 'blue' ? blue : red);
  const setSide = (side: Side, list: HeroData[]) => (side === 'blue' ? setTeams(list, red) : setTeams(blue, list));

  const place = (side: Side, index: number, h: HeroData) => {
    const list = [...teamOf(side)];
    if (index < list.length) list[index] = h;
    else list.push(h);
    setSide(side, list);
    setPicking(null);
  };
  const remove = (side: Side, index: number) => setSide(side, teamOf(side).filter((_, i) => i !== index));

  const disabledFor = (side: Side, index: number) => (h: HeroData) => {
    const replacing = teamOf(side)[index];
    for (const s of ['blue', 'red'] as Side[]) {
      for (const u of teamOf(s)) {
        if (u === replacing) continue;
        if (u.id === h.id) return `已在${SIDE_NAME[s]}`;
        if (sameGroup(u, h)) return `与${u.name}互斥`;
      }
    }
    return null;
  };

  const randomFill = () => {
    const pool = engine.bundle.heroes.filter((h) => !h.isLimited);
    const picked: HeroData[] = [];
    while (picked.length < TEAM_MAX * 2 && pool.length) {
      const h = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      if (!picked.some((u) => sameGroup(u, h))) picked.push(h);
    }
    setTeams(picked.slice(0, TEAM_MAX), picked.slice(TEAM_MAX));
  };

  const tr = useMemo(() => teamRelations(engine.rel, blue, red, scene), [engine, blue, red, scene]);
  const both = blue.length > 0 && red.length > 0;
  const any = blue.length > 0 || red.length > 0;

  return (
    <div className="space-y-3">
      <div className="panel space-y-2.5 p-3">
        {(['blue', 'red'] as Side[]).map((side) => (
          <TeamRow
            key={side}
            side={side}
            team={teamOf(side)}
            picking={picking?.side === side ? picking.index : null}
            onOpen={(index) => setPicking({ side, index })}
            onClose={() => setPicking(null)}
            onPick={(index, h) => place(side, index, h)}
            onRemove={(index) => remove(side, index)}
            disabledFor={(index) => disabledFor(side, index)}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <button type="button" className="btn btn-sm" onClick={() => setTeams(red, blue)} disabled={!any}>
            交换双方
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setTeams([], [])} disabled={!any}>
            清空阵容
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={randomFill} title="随机填入双方各5个英雄，只用于看图示例">
            随机示例阵容
          </button>
          <span className="ml-auto text-[12px] text-dim">阵容保存在链接里，可直接分享；同一英雄不能重复出现，同一英雄的不同形态互斥。</span>
        </div>
      </div>

      {ignored.length > 0 && <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-[13px] text-warn">链接中的部分英雄已忽略：{ignored.join('、')}。</div>}

      {!any ? (
        <Empty className="!py-10">
          在上方为蓝方和红方选择英雄（每方最多5个），即可看到双方之间的克制关系和各自队内的配合关系。
          <br />
          也可以从BP助手或阵容库带着阵容跳转过来。
        </Empty>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4">
          <section className="panel min-w-0 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="panel-title">对阵关系</h2>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[12px] text-mute">场景</span>
                <Segmented
                  value={scene ?? ''}
                  options={SCENE_OPTIONS.map((o) => ({ ...o, title: o.value ? `只显示适用于${o.value}或全局的关系` : undefined }))}
                  onChange={(v) => update({ scene: v || null })}
                />
              </div>
            </div>
            {!both && (
              <p className="mb-3 rounded-md bg-panel2 px-3 py-2 text-[12.5px] text-sub">
                {blue.length ? '红方' : '蓝方'}还没有英雄：现在只显示{blue.length ? '蓝方' : '红方'}的队内配合。为{blue.length ? '红方' : '蓝方'}选择英雄后会显示双方对位的克制关系。
              </p>
            )}
            <div className="mx-auto max-w-[720px]">
              <TeamGraph blue={blue} red={red} scene={scene} selected={selected} onSelect={setSelected} />
            </div>
            <Summary tr={tr} blue={blue} red={red} scene={scene} />
          </section>
          <aside className="sticky top-16 max-h-[calc(100vh-80px)] space-y-3 overflow-y-auto">
            {selected ? (
              <RelationDetail relation={selected} onClose={() => setSelected(null)} />
            ) : (
              <RelationLists key={`${blueStr}|${redStr}|${scene ?? ''}`} tr={tr} onSelect={setSelected} />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function TeamRow({
  side,
  team,
  picking,
  onOpen,
  onClose,
  onPick,
  onRemove,
  disabledFor,
}: {
  side: Side;
  team: HeroData[];
  picking: number | null;
  onOpen: (index: number) => void;
  onClose: () => void;
  onPick: (index: number, h: HeroData) => void;
  onRemove: (index: number) => void;
  disabledFor: (index: number) => (h: HeroData) => string | null;
}) {
  const color = side === 'blue' ? 'text-blue' : 'text-red';
  const ring = side === 'blue' ? 'border-blue/50' : 'border-red/50';
  return (
    <div className="flex items-center gap-2">
      <span className={`w-10 shrink-0 text-[13px] font-semibold ${color}`}>{SIDE_NAME[side]}</span>
      {Array.from({ length: TEAM_MAX }, (_, i) => {
        const h = team[i];
        // 空位只允许点第一个空位之后的任意位置，都追加到末尾
        const index = h ? i : team.length;
        const open = picking === index && (h ? true : i === team.length);
        return (
          <div key={i} className="relative w-[150px]">
            <button
              type="button"
              // 弹层打开时阻止按钮抢焦点，否则输入框先失焦关闭、点击又重新打开
              onMouseDown={(e) => open && e.preventDefault()}
              onClick={() => (open ? onClose() : onOpen(index))}
              className={`flex h-11 w-full items-center gap-2 rounded-lg border px-2 text-left text-[13px] transition-colors ${
                h ? `border-line bg-panel2 hover:border-line2 hover:bg-panel3` : `border-dashed border-line2 text-dim hover:border-dim hover:text-sub`
              } ${open ? ring : ''}`}
              title={h ? `点击更换${h.name}` : `为${SIDE_NAME[side]}添加英雄`}
            >
              {h ? (
                <>
                  <HeroAvatar hero={h} size={30} />
                  <span className="min-w-0 truncate pr-4">{h.name}</span>
                </>
              ) : (
                <span className="w-full text-center">+ 选择英雄</span>
              )}
            </button>
            {h && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="btn btn-ghost btn-sm absolute right-1 top-1/2 !h-6 -translate-y-1/2 !px-1.5 text-mute hover:!text-bad"
                title={`移除${h.name}`}
                aria-label={`移除${h.name}`}
              >
                ×
              </button>
            )}
            {open && (
              <div className="absolute left-0 top-[calc(100%+4px)] z-40 w-[300px] rounded-lg border border-line2 bg-panel p-2 shadow-xl shadow-black/40">
                <HeroPicker autoFocus showAllWhenEmpty onPick={(x) => onPick(index, x)} onClose={onClose} disabledReason={disabledFor(index)} placeholder={`${SIDE_NAME[side]}：搜索英雄`} />
              </div>
            )}
          </div>
        );
      })}
      {team.length > 0 && (
        <span className="ml-1 text-[12px] text-dim">
          {team.length}/{TEAM_MAX}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel2/60 px-3 py-2">
      <div className="text-[12px] text-mute">{label}</div>
      <div className={`text-[18px] font-semibold ${cls}`}>
        {value}
        <span className="ml-0.5 text-[12px] font-normal text-mute">条</span>
      </div>
    </div>
  );
}

function Summary({ tr, blue, red, scene }: { tr: ReturnType<typeof teamRelations>; blue: HeroData[]; red: HeroData[]; scene: ReturnType<typeof parseScene> }) {
  const [showPairs, setShowPairs] = useState(false);
  const pairs = blue.length * red.length;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="蓝方克制红方" value={tr.blueCounters.length} cls="text-blue" />
        <Stat label="红方克制蓝方" value={tr.redCounters.length} cls="text-red" />
        <Stat label="蓝方队内配合" value={tr.blueSynergy.length} cls="text-good" />
        <Stat label="红方队内配合" value={tr.redSynergy.length} cls="text-good" />
      </div>
      <div className="mt-3 space-y-1.5 text-[12.5px] text-sub">
        {pairs > 0 && (
          <p>
            双方共{pairs}个对位，其中<b className="text-ink">{tr.noConclusion.length}</b>个没有已核实的克制关系，图中不画线，显示为暂无结论。
            {tr.noConclusion.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm ml-1" onClick={() => setShowPairs((v) => !v)}>
                {showPairs ? '收起' : '查看这些对位'}
              </button>
            )}
          </p>
        )}
        {showPairs && tr.noConclusion.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tr.noConclusion.map(([b, r]) => (
              <span key={`${b.id}-${r.id}`} className="chip gap-1">
                <span className="text-blue">{b.name}</span>
                <span className="text-dim">×</span>
                <span className="text-red">{r.name}</span>
                <span className="text-dim">暂无结论</span>
              </span>
            ))}
          </div>
        )}
        {scene && tr.sceneHidden > 0 && (
          <p className="text-mute">
            另有{tr.sceneHidden}个对位的克制关系不适用于“{scene}”场景，未画出。
          </p>
        )}
        <p className="text-[12px] text-dim">计数只包含已核实证据的关系；场景筛选保留标注为该场景或“全局”的关系。数字是关系条数，不代表胜负概率。</p>
      </div>
    </div>
  );
}

function RelationLists({ tr, onSelect }: { tr: ReturnType<typeof teamRelations>; onSelect: (r: Relation) => void }) {
  const engine = useEngine();
  const groups: { title: string; cls: string; list: Relation[]; verb: string; verbCls: string }[] = [
    { title: '蓝方克制红方', cls: 'text-blue', list: tr.blueCounters, verb: '克制', verbCls: 'text-blue' },
    { title: '红方克制蓝方', cls: 'text-red', list: tr.redCounters, verb: '克制', verbCls: 'text-red' },
    { title: '蓝方队内配合', cls: 'text-good', list: tr.blueSynergy, verb: '配合', verbCls: 'text-good' },
    { title: '红方队内配合', cls: 'text-good', list: tr.redSynergy, verb: '配合', verbCls: 'text-good' },
  ];
  return (
    <section className="panel p-4">
      <h2 className="panel-title">全部关系</h2>
      <p className="mt-1 text-[12px] text-mute">点击图中连线或下方条目查看依据（官方说明、技能原文、职业赛数据）。按计分权重降序。</p>
      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className={`text-[13px] font-semibold ${g.cls}`}>{g.title}</h3>
              <span className="ml-auto text-[11.5px] text-dim">{g.list.length}条</span>
            </div>
            <ShowMore
              items={g.list}
              initial={6}
              render={(r) => {
                const a = engine.byId.get(r.a);
                const b = engine.byId.get(r.b);
                if (!a || !b) return null;
                return <RelationRow key={`${r.type}-${r.a}-${r.b}`} relation={r} heroes={[a, b]} verb={g.verb} verbClass={g.verbCls} onClick={() => onSelect(r)} />;
              }}
              empty={<Empty className="!py-3">暂无结论</Empty>}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
