// 详情页的一节：带锚点 id，标题旁可放来源说明。
import type { ReactNode } from 'react';

export function WikiSection({ id, title, note, extra, children }: { id: string; title: string; note?: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-wiki-section className="panel scroll-mt-16 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          {note && <span className="text-[12px] text-mute">{note}</span>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 小标题 */
export function SubTitle({ children, count, className = '' }: { children: ReactNode; count?: number; className?: string }) {
  return (
    <h3 className={`mb-2 flex items-center gap-2 text-[13px] font-semibold text-sub ${className}`}>
      {children}
      {count != null && <span className="text-[12px] font-normal text-dim">{count}</span>}
    </h3>
  );
}
