import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { useData } from './lib/data.ts';
import { BpPage } from './pages/BpPage.tsx';

// BP助手是首屏，直接打包；其余页面按需加载
const HeroesPage = lazy(() => import('./pages/HeroesPage.tsx').then((m) => ({ default: m.HeroesPage })));
const HeroDetailPage = lazy(() => import('./pages/HeroDetailPage.tsx').then((m) => ({ default: m.HeroDetailPage })));
const GraphPage = lazy(() => import('./pages/GraphPage.tsx').then((m) => ({ default: m.GraphPage })));
const CompsPage = lazy(() => import('./pages/CompsPage.tsx').then((m) => ({ default: m.CompsPage })));
const TiersPage = lazy(() => import('./pages/TiersPage.tsx').then((m) => ({ default: m.TiersPage })));
const MePage = lazy(() => import('./pages/MePage.tsx').then((m) => ({ default: m.MePage })));
const AboutPage = lazy(() => import('./pages/AboutPage.tsx').then((m) => ({ default: m.AboutPage })));

function Splash({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className={`text-[14px] ${error ? 'text-bad' : 'text-mute'}`}>{text}</div>
    </div>
  );
}

export function App() {
  const { status, error, load } = useData();
  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') return <Splash text="正在加载英雄数据…" />;
  if (status === 'error') return <Splash error text={`${error ?? '加载失败'}。请刷新页面重试。`} />;

  return (
    <HashRouter>
      <Suspense fallback={<Splash text="加载中…" />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<BpPage />} />
            <Route path="heroes" element={<HeroesPage />} />
            <Route path="heroes/:id" element={<HeroDetailPage />} />
            <Route path="tiers" element={<TiersPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="comps" element={<CompsPage />} />
            <Route path="me" element={<MePage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<Splash text="没有这个页面" />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
