// 版本改动：近期官方公告中涉及该英雄的条目。
import type { HeroData, PatchNote } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { Empty } from '../ui.tsx';
import { WikiSection } from './WikiSection.tsx';

export function heroPatches(patches: PatchNote[], id: number) {
  return patches
    .map((p) => ({ p, entry: p.heroes.find((h) => h.id === id) }))
    .filter((x): x is { p: PatchNote; entry: PatchNote['heroes'][number] } => !!x.entry)
    .sort((a, b) => b.p.date.localeCompare(a.p.date));
}

export function PatchesSection({ hero }: { hero: HeroData }) {
  const { bundle } = useEngine();
  const list = heroPatches(bundle.patches, hero.id);
  const dates = bundle.patches.map((p) => p.date).sort();
  const range = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : null;

  return (
    <WikiSection id="patches" title="版本改动" note={range ? `来自官方公告，收录${range}的${bundle.patches.length}篇公告` : '来自官方公告'}>
      {list.length === 0 ? (
        <Empty>近期公告中没有涉及该英雄的改动</Empty>
      ) : (
        <ol className="relative space-y-4 border-l border-line2 pl-5">
          {list.map(({ p, entry }) => (
            <li key={p.id} className="relative">
              <span className="absolute -left-[25px] top-[7px] h-2 w-2 rounded-full bg-line2 ring-4 ring-panel" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[13px] font-medium text-sub">{p.date}</span>
                <a href={p.url} target="_blank" rel="noreferrer" className="text-[13.5px] text-ink underline decoration-line2 underline-offset-2 hover:text-blue">
                  {p.title}
                </a>
                {entry.direction === 'buff' && <span className="inline-flex h-[18px] items-center rounded bg-good/15 px-1.5 text-[11px] text-good">增强</span>}
                {entry.direction === 'nerf' && <span className="inline-flex h-[18px] items-center rounded bg-bad/15 px-1.5 text-[11px] text-bad">削弱</span>}
              </div>
              {entry.lines.length > 0 ? (
                <ul className="mt-1.5 space-y-1 rounded-lg bg-panel2/50 px-3.5 py-2.5">
                  {entry.lines.map((l, i) => (
                    <li key={i} className="text-[13px] leading-relaxed text-sub">
                      {l}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[12.5px] text-dim">公告中提到该英雄，但未列出具体改动条目</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11.5px] text-dim">只有公告标题写明“增强”或“削弱”时才标注方向，其余调整不标注。</p>
    </WikiSection>
  );
}
