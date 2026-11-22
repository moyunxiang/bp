import { NavLink, Outlet } from 'react-router-dom';
import { fmtDate, freshness, useEngine } from '../lib/data.ts';

const NAV = [
  { to: '/', label: 'BP助手', end: true },
  { to: '/heroes', label: '英雄百科' },
  { to: '/graph', label: '关系图谱' },
  { to: '/comps', label: '阵容库' },
  { to: '/me', label: '我的' },
  { to: '/about', label: '数据说明' },
];

export function Layout() {
  const { meta } = useEngine().bundle;
  const fresh = freshness(meta.generatedAt);
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/92 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1680px] items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-wide">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue to-red text-[11px] font-bold text-white">BP</span>
            王者BP助手
          </NavLink>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `rounded-md px-3 py-1.5 text-[13px] transition-colors ${isActive ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink'}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <NavLink to="/about" className="ml-auto flex items-center gap-2 text-[12px] text-mute hover:text-ink" title="查看数据来源与更新情况">
            {meta.season && <span className="chip">{meta.season}</span>}
            <span>
              数据更新于 {fmtDate(meta.generatedAt)}
              {meta.latestPatchDate && ` · 对应至 ${meta.latestPatchDate} 的公告`}
            </span>
            <span className={`h-1.5 w-1.5 rounded-full ${fresh.level === 'fresh' ? 'bg-good' : fresh.level === 'stale' ? 'bg-warn' : 'bg-bad'}`} />
          </NavLink>
        </div>
        {fresh.level !== 'fresh' && (
          <div className={`px-4 py-1.5 text-center text-[12.5px] ${fresh.level === 'old' ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'}`}>
            {fresh.level === 'old'
              ? `数据已 ${fresh.days} 天没有更新，期间很可能有新英雄或平衡性调整，推荐结果仅供参考。`
              : `数据已 ${fresh.days} 天没有更新，可能没有包含最近的版本调整。`}
            在项目目录运行 <code className="kbd">npm run update-data</code> 可更新。
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-4">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-3 text-center text-[12px] text-dim">
        英雄资料、技能原文与图片来自《王者荣耀》官网，著作权归腾讯所有，本站仅作学习与对局参考。推荐分是可解释的分项之和，不是胜率。
      </footer>
    </div>
  );
}
