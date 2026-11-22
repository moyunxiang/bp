// 我的阵容：自定义阵容的新建、修改、删除、收藏，以及已收藏的阵容列表。
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HeroData } from '../../types.ts';
import { useEngine } from '../../lib/data.ts';
import { compKey, useUser, type CustomComp } from '../../lib/userStore.ts';
import { Empty, HeroAvatar, Star } from '../ui.tsx';
import { CompAnalysis } from './CompAnalysis.tsx';
import { HeroPicker } from './HeroPicker.tsx';
import { LimitedChip, Note, graphLink, newCompId, parseIds, resolveHeroes, sameGroup, useProIndex } from './shared.tsx';
import type { ParamPatch } from './shared.tsx';

export const MAX_HEROES = 5;

export function MineTab({ params, update }: { params: URLSearchParams; update: (p: ParamPatch, replace?: boolean) => void }) {
  const customComps = useUser((s) => s.customComps);
  const edit = params.get('edit');
  const sorted = useMemo(() => [...customComps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)), [customComps]);
  const editing = edit && edit !== 'new' ? customComps.find((c) => c.id === edit) ?? null : null;

  return (
    <div className="space-y-3">
      <Note>
        自定义阵容和收藏保存在当前浏览器本地（localStorage），换浏览器或清除网站数据会丢失。可以在
        <Link to="/me" className="mx-0.5 text-blue hover:underline">
          “我的”页面
        </Link>
        导出，覆盖仓库中的 <code className="kbd">user/profile.json</code> 后提交，作为默认值保存。
      </Note>
      <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-4">
        <aside className="space-y-4">
          <section className="panel p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="panel-title">我的阵容（{customComps.length}）</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => update({ edit: 'new' })}>
                新建阵容
              </button>
            </div>
            {sorted.length === 0 ? (
              <p className="px-1 py-3 text-[12.5px] text-mute">还没有自定义阵容。可以新建，或在“职业赛阵容”里把阵容另存为我的阵容。</p>
            ) : (
              <ul className="space-y-1">
                {sorted.map((c) => (
                  <CustomRow key={c.id} c={c} active={c.id === edit} onSelect={() => update({ edit: c.id })} />
                ))}
              </ul>
            )}
          </section>
          <FavoritesList />
        </aside>

        <div>
          {edit === 'new' ? (
            <Editor key="new" initial={{ id: newCompId(), name: '', heroes: [], note: '' }} isNew onSaved={(id) => update({ edit: id }, true)} onDeleted={() => update({ edit: null })} />
          ) : editing ? (
            <Editor key={editing.id} initial={editing} onSaved={() => undefined} onDeleted={() => update({ edit: null })} />
          ) : edit ? (
            <Empty>没有找到这个自定义阵容（ID：{edit}），可能已被删除或不在当前浏览器中。</Empty>
          ) : (
            <Empty>
              从左侧选择一个阵容进行修改，或
              <button type="button" className="mx-1 text-blue hover:underline" onClick={() => update({ edit: 'new' })}>
                新建阵容
              </button>
              。
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomRow({ c, active, onSelect }: { c: CustomComp; active: boolean; onSelect: () => void }) {
  const { byId } = useEngine();
  const key = compKey(c.heroes);
  const fav = useUser((s) => s.favoriteComps.includes(key));
  const toggle = useUser((s) => s.toggleFavoriteComp);
  const { heroes, missing } = resolveHeroes(byId, c.heroes);
  return (
    <li className={`flex items-center gap-1 rounded-md border ${active ? 'border-blue bg-blue/10' : 'border-transparent hover:bg-panel2'}`}>
      <button type="button" className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={onSelect} aria-pressed={active}>
        <div className="truncate text-[13px] text-ink">{c.name || '未命名阵容'}</div>
        <div className="mt-1 flex items-center gap-0.5">
          {heroes.map((h) => (
            <HeroAvatar key={h.id} hero={h} size={22} />
          ))}
          {heroes.length === 0 && <span className="text-[11.5px] text-dim">尚未选英雄</span>}
          {missing.length > 0 && <span className="ml-1 text-[11px] text-warn">{missing.length}个ID无效</span>}
          <span className="ml-auto text-[11px] text-dim">{c.updatedAt}</span>
        </div>
      </button>
      {c.heroes.length > 0 && <Star on={fav} onClick={() => toggle(key)} />}
    </li>
  );
}

function FavoritesList() {
  const { byId } = useEngine();
  const favs = useUser((s) => s.favoriteComps);
  const customComps = useUser((s) => s.customComps);
  const toggle = useUser((s) => s.toggleFavoriteComp);
  const proIndex = useProIndex();

  const pro = favs.filter((k) => proIndex.has(k));
  const others = favs.filter((k) => !proIndex.has(k));

  const row = (k: string) => {
    const p = proIndex.get(k);
    const ids = parseIds(k);
    const { heroes, missing } = resolveHeroes(byId, ids);
    const custom = customComps.filter((c) => compKey(c.heroes) === k);
    return (
      <li key={k} className="rounded-md border border-line bg-panel2/40 px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {heroes.map((h) => (
            <HeroAvatar key={h.id} hero={h} size={22} />
          ))}
          <span className="ml-auto">
            <Star on onClick={() => toggle(k)} />
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
          {p ? (
            <span className="text-sub">
              职业赛{p.kind === 'lineup' ? '完整阵容' : '三人组合'} · 出现{p.n}次 · {p.first} ~ {p.last}
            </span>
          ) : custom.length ? (
            <span className="text-sub">我的阵容：{custom.map((c) => c.name || '未命名阵容').join('、')}</span>
          ) : (
            <span className="text-mute">不在当前职业赛数据中</span>
          )}
          {missing.length > 0 && <span className="text-warn">{missing.length}个英雄ID无效</span>}
        </div>
        <div className="mt-1 flex gap-1">
          {p && (
            <Link className="btn btn-ghost btn-sm" to={`/comps?tab=pro&comp=${k}`}>
              查看分析
            </Link>
          )}
          <Link className="btn btn-ghost btn-sm" to={`/comps?tab=compare&a=${p ? 'pro' : 'fav'}:${k}`}>
            拿去对比
          </Link>
        </div>
      </li>
    );
  };

  return (
    <section className="panel p-3">
      <h2 className="panel-title mb-2">已收藏的职业赛阵容（{pro.length}）</h2>
      {pro.length === 0 ? <p className="px-1 py-2 text-[12.5px] text-mute">还没有收藏。在“职业赛阵容”里点星标即可收藏。</p> : <ul className="space-y-1.5">{pro.map(row)}</ul>}
      {others.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-3 text-[12px] font-medium text-mute">其他收藏（{others.length}）</h3>
          <ul className="space-y-1.5">{others.map(row)}</ul>
        </>
      )}
    </section>
  );
}

function Editor({ initial, isNew = false, onSaved, onDeleted }: { initial: Omit<CustomComp, 'updatedAt'> & { updatedAt?: string }; isNew?: boolean; onSaved: (id: string) => void; onDeleted: () => void }) {
  const { byId } = useEngine();
  const saveComp = useUser((s) => s.saveComp);
  const deleteComp = useUser((s) => s.deleteComp);
  const favorites = useUser((s) => s.favoriteComps);
  const toggle = useUser((s) => s.toggleFavoriteComp);

  const [name, setName] = useState(initial.name);
  const [ids, setIds] = useState<number[]>(initial.heroes);
  const [note, setNote] = useState(initial.note);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const { heroes, missing } = useMemo(() => resolveHeroes(byId, ids), [byId, ids]);
  const dirty = isNew || name !== initial.name || note !== initial.note || ids.join(',') !== initial.heroes.join(',');
  const full = heroes.length >= MAX_HEROES;

  const reason = (h: HeroData) => {
    if (ids.includes(h.id)) return '已在阵容中';
    const g = heroes.find((x) => sameGroup(x, h));
    if (g) return `与${g.name}是同一英雄的不同形态`;
    return null;
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
  };

  const save = () => {
    const next = { id: initial.id, name: name.trim() || '未命名阵容', heroes: ids.filter((id) => byId.has(id)), note: note.trim() };
    saveComp(next);
    setName(next.name);
    setIds(next.heroes);
    setNote(next.note);
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    onSaved(initial.id);
  };

  const remove = () => {
    if (!window.confirm(`确定删除阵容“${initial.name || '未命名阵容'}”？删除后无法恢复（除非之前导出过）。`)) return;
    deleteComp(initial.id);
    onDeleted();
  };

  const validIds = useMemo(() => heroes.map((h) => h.id), [heroes]);
  const isFav = validIds.length > 0 && favorites.includes(compKey(validIds));

  return (
    <div className="grid grid-cols-[minmax(380px,1fr)_600px] items-start gap-4">
      <section className="panel space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="panel-title">{isNew ? '新建阵容' : '修改阵容'}</h2>
          <div className="flex items-center gap-1">
            {validIds.length > 0 && <Star on={isFav} onClick={() => toggle(compKey(validIds))} />}
            {!isNew && (
              <button type="button" className="btn btn-ghost btn-sm hover:!text-bad" onClick={remove}>
                删除
              </button>
            )}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] text-mute">名称</span>
          <input className="input" value={name} maxLength={40} placeholder="例如：双前排保射手" onChange={(e) => setName(e.target.value)} />
        </label>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-[12px] text-mute">
            <span>英雄（最多{MAX_HEROES}个，同一英雄或同一英雄的不同形态不能重复）</span>
            <span>
              {heroes.length}/{MAX_HEROES}
            </span>
          </div>
          <HeroPicker onPick={(h) => setIds([...ids, h.id])} disabledReason={reason} disabled={full} placeholder="搜索英雄加入阵容" />
          <ul className="mt-2 space-y-1">
            {heroes.map((h, i) => (
              <li key={h.id} className="flex items-center gap-2 rounded-md border border-line bg-panel2/50 px-2 py-1">
                <span className="w-4 text-center text-[11.5px] text-dim">{i + 1}</span>
                <HeroAvatar hero={h} size={26} />
                <Link to={`/heroes/${h.id}`} className="text-[13px] hover:text-blue">
                  {h.name}
                </Link>
                {h.isLimited && <LimitedChip />}
                <span className="ml-auto flex items-center">
                  <button type="button" className="btn btn-ghost btn-sm !px-1.5" disabled={i === 0} onClick={() => move(i, -1)} title="上移">
                    ↑
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm !px-1.5" disabled={i === heroes.length - 1} onClick={() => move(i, 1)} title="下移">
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm hover:!text-bad" onClick={() => setIds(ids.filter((x) => x !== h.id))}>
                    移除
                  </button>
                </span>
              </li>
            ))}
            {heroes.length === 0 && <li className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[12.5px] text-mute">还没有英雄</li>}
          </ul>
          {heroes.some((h) => h.isLimited) && <p className="mt-1 text-[12px] text-warn">阵容中有限时英雄，排位/巅峰赛中不可用。</p>}
          {missing.length > 0 && (
            <p className="mt-1 text-[12px] text-warn">
              有{missing.length}个英雄ID（{missing.join('、')}）在当前数据中不存在，保存时会被去掉。
            </p>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] text-mute">备注</span>
          <textarea className="input !h-24 py-2 leading-relaxed" value={note} maxLength={500} placeholder="自己的打法要点、适用场景等" onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={!dirty} onClick={save}>
            {isNew ? '保存阵容' : '保存修改'}
          </button>
          {!isNew && dirty && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setName(initial.name);
                setIds(initial.heroes);
                setNote(initial.note);
              }}
            >
              放弃修改
            </button>
          )}
          {validIds.length > 0 && (
            <>
              <Link className="btn btn-ghost btn-sm" to={graphLink(validIds)}>
                在图谱中对阵查看
              </Link>
              {!isNew && (
                <Link className="btn btn-ghost btn-sm" to={`/comps?tab=compare&a=my:${initial.id}`}>
                  拿去对比
                </Link>
              )}
            </>
          )}
          <span className="ml-auto text-[12px] text-mute">{dirty ? (isNew ? '尚未保存' : '有未保存的修改') : savedAt ? `已保存 ${savedAt}` : initial.updatedAt ? `最后修改 ${initial.updatedAt}` : ''}</span>
        </div>
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="panel-title">阵容分析</h2>
          <span className="text-[12px] text-dim">随编辑实时更新</span>
        </div>
        <CompAnalysis heroIds={validIds} />
      </section>
    </div>
  );
}
