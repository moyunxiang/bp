// 官方推荐出装、铭文与召唤师技能。
import { useMemo } from 'react';
import type { HeroData } from '../../types.ts';
import { fmtDate, useEngine } from '../../lib/data.ts';
import { Empty, GameIcon } from '../ui.tsx';
import { SubTitle, WikiSection } from './WikiSection.tsx';

const RUNE_COLOR: Record<string, [string, string]> = {
  red: ['红色', 'bg-red'],
  blue: ['蓝色', 'bg-blue'],
  yellow: ['黄色', 'bg-warn'],
};

function Tips({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return (
    <p className="quote mt-2.5 whitespace-pre-line text-[12.5px] leading-relaxed">
      <span className="mr-1 text-mute">官方说明：</span>
      {text.trim()}
    </p>
  );
}

export function BuildsSection({ hero }: { hero: HeroData }) {
  const { bundle } = useEngine();
  const eq = bundle.equipment;
  const items = useMemo(() => new Map(eq.items.map((i) => [i.id, i])), [eq.items]);
  const runes = useMemo(() => new Map(eq.runes.map((i) => [i.id, i])), [eq.runes]);
  const summoners = useMemo(() => new Map(eq.summoners.map((i) => [i.id, i])), [eq.summoners]);
  const builds = hero.builds.filter((b) => b.items.length > 0);

  return (
    <WikiSection id="builds" title="出装与铭文" note={<>官方推荐，来自官方英雄页面，抓取于{fmtDate(bundle.meta.officialFetchedAt)}</>}>
      <SubTitle>推荐出装</SubTitle>
      {builds.length === 0 ? (
        <Empty className="py-4">官方页面没有提供推荐出装</Empty>
      ) : (
        <div className="space-y-3">
          {builds.map((b, bi) => (
            <div key={bi} className="rounded-lg border border-line bg-panel2/40 p-3.5">
              <div className="mb-2 text-[12px] text-mute">方案{bi + 1}</div>
              <ol className="grid grid-cols-6 gap-2">
                {b.items.map((id, i) => {
                  const it = items.get(id);
                  return (
                    <li key={`${id}-${i}`} className="rounded-md border border-line bg-panel p-2.5" title={it?.desc}>
                      <div className="flex items-center gap-2">
                        <GameIcon kind="item" id={id} name={it?.name} size={38} />
                        <div className="min-w-0">
                          <div className="text-[11px] leading-none text-dim">第{i + 1}件</div>
                          <div className={`mt-1 truncate text-[13px] font-medium ${it ? 'text-ink' : 'text-mute'}`}>{it ? it.name : `未知装备#${id}`}</div>
                        </div>
                      </div>
                      {it?.desc && <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-mute">{it.desc}</p>}
                    </li>
                  );
                })}
              </ol>
              <Tips text={b.tips} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-panel2/40 p-3.5">
          <SubTitle>推荐铭文</SubTitle>
          {hero.rune.ids.length === 0 ? (
            <p className="text-[12.5px] text-dim">官方页面没有提供推荐铭文</p>
          ) : (
            <ul className="space-y-2">
              {hero.rune.ids.map((id, i) => {
                const r = runes.get(id);
                const color = r ? RUNE_COLOR[r.color] : undefined;
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-2.5">
                    <GameIcon kind="rune" id={id} name={r?.name} size={34} />
                    <div className="min-w-0">
                      <span className={`text-[13px] font-medium ${r ? 'text-ink' : 'text-mute'}`}>{r ? r.name : `未知铭文#${id}`}</span>
                      {color && <span className="ml-1.5 text-[11px] text-dim">{color[0]}</span>}
                      {r?.desc && <p className="text-[12px] text-mute">{r.desc}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Tips text={hero.rune.tips} />
        </div>

        <div className="rounded-lg border border-line bg-panel2/40 p-3.5">
          <SubTitle>推荐召唤师技能</SubTitle>
          {hero.summoners.length === 0 ? (
            <p className="text-[12.5px] text-dim">官方页面没有提供推荐召唤师技能</p>
          ) : (
            <ul className="space-y-2">
              {hero.summoners.map((id, i) => {
                const s = summoners.get(id);
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-2.5">
                    <GameIcon kind="summoner" id={id} name={s?.name} size={38} />
                    <div className="min-w-0">
                      <span className={`text-[13px] font-medium ${s ? 'text-ink' : 'text-mute'}`}>{s ? s.name : `未知召唤师技能#${id}`}</span>
                      {s?.desc && <p className="text-[12px] leading-relaxed text-mute">{s.desc}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </WikiSection>
  );
}
