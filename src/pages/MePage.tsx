import { Section } from '../components/ui.tsx';
import { HeroPool } from '../components/me/HeroPool.tsx';
import { Prefs } from '../components/me/Prefs.tsx';
import { Favorites } from '../components/me/Favorites.tsx';
import { ImportExport } from '../components/me/ImportExport.tsx';

export function MePage() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="英雄池"><HeroPool /></Section>
      <div className="grid grid-cols-2 gap-4">
        <Section title="默认偏好"><Prefs /></Section>
        <Section title="收藏的英雄"><Favorites /></Section>
      </div>
      <Section title="导入与导出"><ImportExport /></Section>
    </div>
  );
}
