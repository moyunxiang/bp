// 关系证据展示：官方说明、规则推导（带双方技能原文）、职业赛数据、解说条目。
import { Link } from 'react-router-dom';
import { useEngine, useTagMap } from '../lib/data.ts';
import type { Evidence, Relation } from '../engine/relations.ts';
import type { HeroData, ProfileTag } from '../types.ts';
import { HeroAvatar } from './ui.tsx';

const KIND_LABEL: Record<Evidence['kind'], [string, string]> = {
  official: ['官方', 'text-blue bg-blue/15'],
  rule: ['机制', 'text-good bg-good/15'],
  kpl: ['职业赛', 'text-gold bg-gold/15'],
  commentary: ['解说', 'text-sub bg-panel3'],
};

export function KindBadge({ kind }: { kind: Evidence['kind'] }) {
  const [label, cls] = KIND_LABEL[kind];
  return <span className={`inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[11px] ${cls}`}>{label}</span>;
}

/** 关系上出现过的证据类型徽标 */
export function KindBadges({ relation }: { relation: Relation }) {
  const kinds = [...new Set(relation.evidence.map((e) => e.kind))];
  return (
    <span className="inline-flex gap-1">
      {kinds.map((k) => (
        <KindBadge key={k} kind={k} />
      ))}
    </span>
  );
}

export function TagQuotes({ hero, tags, notes }: { hero: HeroData; tags: ProfileTag[]; notes: string[] }) {
  const tagMap = useTagMap();
  return (
    <div className="mt-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] text-sub">
        <HeroAvatar hero={hero} size={16} />
        {hero.name}
      </div>
      <ul className="space-y-1">
        {tags.slice(0, 4).map((t, i) => (
          <li key={i} className="quote text-[12px]">
            <span className="text-mute">
              {t.slot}·{tagMap.get(t.tag)?.name ?? t.tag}：
            </span>
            “{t.quote}”
          </li>
        ))}
        {notes.map((n, i) => (
          <li key={`n${i}`} className="quote text-[12px] text-mute">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceItem({ e, doubtful }: { e: Evidence; doubtful?: boolean }) {
  const engine = useEngine();
  const fetched = engine.bundle.meta.officialFetchedAt.slice(0, 10);

  if (e.kind === 'official') {
    const page = engine.byId.get(e.page);
    return (
      <div>
        <div className="flex items-center gap-2">
          <KindBadge kind="official" />
          {doubtful && <span className="chip !text-warn">可能过期，不计分</span>}
          <span className="text-[12px] text-mute">
            出自
            {page ? (
              <a href={page.sourceUrl} target="_blank" rel="noreferrer" className="mx-0.5 underline decoration-line2 underline-offset-2 hover:text-blue">
                {page.name}的官方页面
              </a>
            ) : (
              '官方页面'
            )}
            · 抓取于{fetched} · 撰写时间官方未注明
          </span>
        </div>
        <p className="quote mt-1.5 text-[13px] leading-relaxed">{e.text}</p>
      </div>
    );
  }

  if (e.kind === 'rule') {
    const ra = engine.byId.get(e.aId)!;
    const rb = engine.byId.get(e.bId)!;
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind="rule" />
          <span className="text-[13px] text-ink">{e.rule.name}</span>
          <span className="text-[12px] text-mute">由双方技能原文推导，属于机制倾向</span>
        </div>
        <p className="mt-1 text-[13px] text-sub">{e.rule.reason.replace('{a}', ra.name).replace('{b}', rb.name)}。</p>
        <TagQuotes hero={ra} tags={e.aTags} notes={e.aNotes} />
        <TagQuotes hero={rb} tags={e.bTags} notes={e.bNotes} />
        <p className="mt-1.5 text-[12px] text-mute">
          <span className="text-sub">成立条件：</span>
          {e.rule.condition}
        </p>
        <p className="text-[12px] text-dim">依据的通用机制：{e.rule.basis}</p>
      </div>
    );
  }

  if (e.kind === 'kpl') {
    const p = engine.bundle.kpl!.pairs;
    return (
      <div>
        <div className="flex items-center gap-2">
          <KindBadge kind="kpl" />
          <span className="text-[12px] text-mute">
            {p.from} ~ {p.to} · 共{p.teamGames}个队伍场次
          </span>
        </div>
        <p className="mt-1 text-[13px] text-sub">
          同队出场 <b className="text-ink">{e.n}</b> 次，按各自出场率独立估计应为 {e.expected} 次，是期望的 <b className="text-ink">{e.lift}</b> 倍。只说明职业队倾向于把两者放在一起，不代表胜率。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind="commentary" />
        {doubtful && <span className="chip !text-warn">未核实，不计分</span>}
        <a href={e.item.url} target="_blank" rel="noreferrer" className="text-[12px] text-mute underline decoration-line2 underline-offset-2 hover:text-blue">
          {e.item.uploader}《{e.item.title}》· {e.item.date}
        </a>
      </div>
      <p className="quote mt-1.5 text-[13px]">{e.item.claim}</p>
    </div>
  );
}

export function EvidenceList({ relation }: { relation: Relation }) {
  return (
    <div className="space-y-3">
      {relation.evidence.map((e, i) => (
        <EvidenceItem key={i} e={e} />
      ))}
      {relation.doubtful.map((e, i) => (
        <EvidenceItem key={`d${i}`} e={e} doubtful />
      ))}
    </div>
  );
}

/** 一条关系的完整卡片：谁对谁、适用场景、全部证据 */
export function RelationCard({ relation, perspective }: { relation: Relation; perspective?: number }) {
  const engine = useEngine();
  const a = engine.byId.get(relation.a)!;
  const b = engine.byId.get(relation.b)!;
  const verb = relation.type === 'counter' ? '克制' : '配合';
  const [x, y] = relation.type === 'synergy' && perspective === b.id ? [b, a] : [a, b];
  return (
    <div className="rounded-lg border border-line bg-panel2/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Link to={`/heroes/${x.id}`} className="flex items-center gap-1.5 font-medium hover:text-blue">
          <HeroAvatar hero={x} size={24} />
          {x.name}
        </Link>
        <span className={relation.type === 'counter' ? 'text-bad' : 'text-good'}>{verb}</span>
        <Link to={`/heroes/${y.id}`} className="flex items-center gap-1.5 font-medium hover:text-blue">
          <HeroAvatar hero={y} size={24} />
          {y.name}
        </Link>
        <span className="ml-auto flex items-center gap-1">
          {relation.scenes.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </span>
      </div>
      <EvidenceList relation={relation} />
    </div>
  );
}
