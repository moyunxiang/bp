// BP助手：录入双方禁选，实时给出推荐。为“手机打游戏、电脑在旁边”的场景优化，全程可只用键盘。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LANES, LANE_NAME, type HeroData, type Lane } from '../types.ts';
import { useEngine } from '../lib/data.ts';
import { useBp } from '../lib/bpStore.ts';
import { useUser } from '../lib/userStore.ts';
import { MODE_INFO, activeSlot, isComplete, other, pickedIds, place, sequence, setBanCount, setLaneLock, slotValue, unavailableReason, type Mode, type Side, type Slot } from '../engine/draft.ts';
import { recommendBans, recommendPicks } from '../engine/recommend.ts';
import { Segmented } from '../components/ui.tsx';
import { BanRow, TeamColumn } from '../components/bp/Board.tsx';
import { Picker, usePickerResults, type PickerFilter } from '../components/bp/Picker.tsx';
import { BanList, CompareTable, Matchup, PickList, type RecTab } from '../components/bp/RecPanel.tsx';
import { PlaybookView } from '../components/play/PlaybookView.tsx';

const SIDE_NAME: Record<Side, string> = { blue: '蓝方', red: '红方' };

function Shortcuts() {
  const rows: [string, string][] = [
    ['直接打字', '搜索英雄（中文、拼音、首字母、外号）'],
    ['Enter', '选用搜索结果的第一个'],
    ['1 – 9', '有输入时选对应序号的搜索结果；没有输入时选用对应序号的推荐'],
    ['Backspace', '输入框为空时撤销上一手'],
    ['Ctrl/⌘ + Z', '撤销'],
    ['Ctrl + Y / ⌘ + Shift + Z', '重做'],
    ['Tab', '切换到另一方的同类位置'],
    ['Alt + 1 – 5', '把刚选的英雄（或当前选中的位置）指定为 对抗/打野/中路/发育/游走'],
    ['Esc', '清空输入；再按一次回到规则顺序的位置'],
    ['Alt + N', '开始新的一局'],
  ];
  return (
    <div className="absolute right-0 top-9 z-30 w-[440px] rounded-xl border border-line2 bg-panel2 p-3 shadow-2xl">
      <div className="mb-2 text-[12px] font-medium text-sub">快捷键</div>
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="w-[150px] py-1 align-top">
                <span className="kbd !h-auto whitespace-nowrap px-1.5 py-0.5">{k}</span>
              </td>
              <td className="py-1 text-mute">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BpPage() {
  const engine = useEngine();
  const { byId } = engine;
  const { draft, past, future, lastPick, commit, undo, redo, reset, setCursor } = useBp();
  const prefs = useUser((s) => s.prefs);
  const setPrefs = useUser((s) => s.setPrefs);
  const pool = useUser((s) => s.pool);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PickerFilter>({ lane: 0, type: 0 });
  const [tab, setTab] = useState<RecTab>('pick');
  const [compare, setCompare] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = activeSlot(draft);
  const done = isComplete(draft) && !draft.cursor;
  // 推荐视角：当前要填的位置属于哪一方；全部填完后看我方
  const side: Side = active?.side ?? prefs.mySide;
  const isMine = side === prefs.mySide;
  const isMyOwnPick = active?.kind === 'pick' && isMine && prefs.myFloor != null && active.index === prefs.myFloor - 1;
  // 指定了楼层时，只有轮到“我”才用我的位置和英雄池；没指定楼层时，我方每一手都按我的设置
  const personal = isMine && (prefs.myFloor == null || isMyOwnPick);
  const wantLane = personal && active?.kind === 'pick' ? prefs.myLane : null;
  const usePool = prefs.usePool && pool.length > 0 && personal;

  const blueTeam = useMemo(() => pickedIds(draft, 'blue').map((id) => byId.get(id)!).filter(Boolean), [draft, byId]);
  const redTeam = useMemo(() => pickedIds(draft, 'red').map((id) => byId.get(id)!).filter(Boolean), [draft, byId]);

  // 手动指定的分路（与上面的队伍同序），供“打法”里的分路对位使用
  const blueLocks = useMemo(() => draft.laneLocks.blue.filter((_, i) => draft.picks.blue[i] != null && byId.has(draft.picks.blue[i]!)), [draft, byId]);
  const redLocks = useMemo(() => draft.laneLocks.red.filter((_, i) => draft.picks.red[i] != null && byId.has(draft.picks.red[i]!)), [draft, byId]);
  const mine = prefs.mySide === 'blue';

  const pickSideFull = draft.picks[side].every((x) => x != null);
  const pickRecs = useMemo(() => (pickSideFull ? [] : recommendPicks(engine, draft, { side, pool: usePool ? pool : null, wantLane })), [engine, draft, side, usePool, pool, wantLane, pickSideFull]);
  const banRecs = useMemo(
    () => recommendBans(engine, draft, { side, pool: isMine ? pool : null, intents: isMine ? compare : [], wantLane: isMine ? prefs.myLane : null }),
    [engine, draft, side, isMine, pool, compare, prefs.myLane],
  );

  const results = usePickerResults(draft, active, query, filter);

  // 进入禁用/选人阶段时自动切到对应的推荐
  const activeKind = active?.kind ?? null;
  useEffect(() => {
    if (activeKind === 'ban') setTab('ban');
    else if (activeKind === 'pick') setTab((t) => (t === 'ban' ? 'pick' : t));
  }, [activeKind]);

  // 双方选满后自动切到“打法”
  useEffect(() => {
    if (done) setTab('play');
  }, [done]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  const placeHero = useCallback(
    (hero: HeroData, slot: Slot | null = active) => {
      if (!slot) {
        setNotice('双方都已选满。点击某个位置可以修改，或开始新的一局。');
        return;
      }
      const reason = unavailableReason(draft, hero, slot, byId);
      if (reason) {
        const why = { banned: slot.kind === 'ban' ? '这一方已经禁过它' : '它已被禁用', picked: '它已被选走', group: '同一英雄的其他形态已被选', limited: '限时英雄在排位和巅峰赛中不可用' }[reason];
        setNotice(`${hero.name}不能放在这里：${why}`);
        return;
      }
      let next = place(draft, slot, hero.id);
      // 我自己的那一手：自动锁定为我的位置
      if (slot.kind === 'pick' && slot.side === prefs.mySide && prefs.myFloor === slot.index + 1 && prefs.myLane) next = setLaneLock(next, slot.side, slot.index, prefs.myLane);
      commit(next, slot);
      setQuery('');
      setCompare((c) => c.filter((id) => id !== hero.id));
      inputRef.current?.focus();
    },
    [active, draft, byId, prefs.mySide, prefs.myFloor, prefs.myLane, commit],
  );

  const clearSlot = useCallback((slot: Slot) => commit(place(draft, slot, null), null), [commit, draft]);
  const selectSlot = useCallback(
    (slot: Slot) => {
      setCursor(slot);
      inputRef.current?.focus();
    },
    [setCursor],
  );
  const lockLane = useCallback((s: Side, index: number, lane: Lane | null) => commit(setLaneLock(draft, s, index, lane), null), [commit, draft]);

  const newGame = useCallback(() => {
    reset(draft.mode, draft.banPerSide);
    setQuery('');
    setCompare([]);
    setTab('ban');
    inputRef.current?.focus();
  }, [reset, draft.mode, draft.banPerSide]);

  const changeMode = (mode: Mode) => {
    setPrefs({ mode });
    reset(mode, draft.banPerSide);
    setCompare([]);
  };
  const changeBanCount = (n: number) => {
    setPrefs({ banPerSide: n });
    commit(setBanCount(draft, n), null);
  };

  const toggleCompare = (id: number) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 4 ? [...c.slice(1), id] : [...c, id]));

  // ---- 键盘 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inOtherField = target && target !== inputRef.current && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (inOtherField) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.altKey && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const lane = Number(e.code.slice(5)) as Lane;
        const cur = draft.cursor;
        const t = cur && cur.kind === 'pick' && slotValue(draft, cur) != null ? cur : lastPick && slotValue(draft, lastPick) != null ? lastPick : null;
        if (t) lockLane(t.side, t.index, lane);
        else setNotice('还没有可以指定分路的英雄');
        return;
      }
      if (e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        newGame();
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === 'Tab') {
        if (!active) return;
        e.preventDefault();
        const o = other(active.side);
        const next = sequence(draft).find((s) => s.side === o && s.kind === active.kind && slotValue(draft, s) == null);
        if (next) setCursor(next);
        else setNotice(`${SIDE_NAME[o]}没有空的${active.kind === 'ban' ? '禁用' : '选人'}位了`);
        inputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (query) setQuery('');
        else if (draft.cursor) setCursor(null);
        setShowKeys(false);
        return;
      }
      if (e.key === 'Backspace' && !query) {
        e.preventDefault();
        if (past.length) undo();
        return;
      }
      if (e.key === 'Enter') {
        if (query.trim() && results.available[0]) {
          e.preventDefault();
          placeHero(results.available[0]);
        } else if (query.trim()) {
          // 选不了时全选输入内容，接着打字会直接替换
          setNotice(results.items.length ? `${results.items[0].hero.name}在这个位置不可用` : '没有匹配的英雄');
          inputRef.current?.select();
        }
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key) - 1;
        if (query.trim()) {
          const h = results.available[n];
          if (h) placeHero(h);
          return;
        }
        if (!active) return;
        const h = active.kind === 'ban' ? banRecs[n]?.hero : pickRecs[n]?.hero;
        if (h) placeHero(h);
        return;
      }
      // 其他可打印字符：把焦点交给搜索框
      if (e.key.length === 1 && document.activeElement !== inputRef.current) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, banRecs, draft, lastPick, lockLane, newGame, past.length, pickRecs, placeHero, query, redo, results.available, setCursor, undo]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const boardProps = { draft, active, mySide: prefs.mySide, myFloor: prefs.myFloor, onSelect: selectSlot, onClear: clearSlot, onLane: lockLane };
  const limit = prefs.research ? 20 : 8;

  const stepText = !active
    ? 'BP已完成'
    : `${SIDE_NAME[active.side]}${active.side === prefs.mySide ? '（我方）' : '（对方）'}${active.kind === 'ban' ? `禁用第${active.index + 1}个` : `${active.index + 1}楼选人`}${isMyOwnPick ? ' · 轮到你' : ''}`;
  const placeholder = !active ? 'BP已完成 · 点击某个位置可修改 · Alt+N 开始新的一局' : `${stepText} · 输入英雄名、拼音或首字母`;

  const recTitle =
    tab === 'ban'
      ? `为${SIDE_NAME[side]}${isMine ? '（我方）' : '（对方）'}推荐禁用`
      : `${isMine ? `为${SIDE_NAME[side]}（我方）推荐选人` : `${SIDE_NAME[side]}（对方）可能的选择`}${wantLane ? ` · ${LANE_NAME[wantLane]}` : ''}${usePool ? ' · 仅我的英雄池' : ''}`;

  return (
    <div className="flex h-[calc(100vh-48px-32px-45px)] min-h-[640px] flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented<Mode> value={draft.mode} onChange={changeMode} options={(Object.keys(MODE_INFO) as Mode[]).map((m) => ({ value: m, label: MODE_INFO[m].name, title: MODE_INFO[m].desc }))} />
        <label className="flex items-center gap-1.5 text-[12px] text-mute" title="每方的禁用位数量。不同段位、不同模式的数量不同，按你的对局调整。">
          每方禁用
          <select className="input !h-7 !w-[52px] !px-1.5 !text-[12.5px]" value={draft.banPerSide} onChange={(e) => changeBanCount(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="h-4 w-px bg-line2" />
        <label className="flex items-center gap-1.5 text-[12px] text-mute">
          我方
          <Segmented<Side>
            value={prefs.mySide}
            onChange={(v) => setPrefs({ mySide: v })}
            options={[
              { value: 'blue', label: <span className="text-blue">蓝方</span> },
              { value: 'red', label: <span className="text-red">红方</span> },
            ]}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-mute" title="指定后，只有轮到你这一楼时才按“我的位置”和“我的英雄池”推荐，队友的选择按理论最优">
          我在
          <select className="input !h-7 !w-[78px] !px-1.5 !text-[12.5px]" value={prefs.myFloor ?? 0} onChange={(e) => setPrefs({ myFloor: Number(e.target.value) || null })}>
            <option value={0}>不指定</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}楼
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-mute" title="指定后只推荐能打这个位置的英雄">
          我打
          <select className="input !h-7 !w-[84px] !px-1.5 !text-[12.5px]" value={prefs.myLane ?? 0} onChange={(e) => setPrefs({ myLane: (Number(e.target.value) || null) as Lane | null })}>
            <option value={0}>不指定</option>
            {LANES.map((l) => (
              <option key={l} value={l}>
                {LANE_NAME[l]}
              </option>
            ))}
          </select>
        </label>
        <Segmented<number>
          value={prefs.usePool ? 1 : 0}
          onChange={(v) => setPrefs({ usePool: v === 1 })}
          options={[
            { value: 0, label: '理论最优', title: '在所有可选英雄中推荐' },
            { value: 1, label: `我的英雄池${pool.length ? `(${pool.length})` : ''}`, title: '只在我的英雄池里推荐，并按熟练度加分' },
          ]}
        />
        {prefs.usePool && pool.length === 0 && (
          <Link to="/me" className="text-[12px] text-warn hover:underline">
            英雄池还是空的，去添加
          </Link>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Segmented<number>
            value={prefs.research ? 1 : 0}
            onChange={(v) => setPrefs({ research: v === 1 })}
            options={[
              { value: 0, label: '实战', title: '只显示结论，界面最简' },
              { value: 1, label: '研究', title: '展开每项得分的依据和原文证据，并显示双方关系图' },
            ]}
          />
          <button type="button" className="btn btn-sm" onClick={undo} disabled={!past.length} title="撤销（Ctrl/⌘+Z，或在空输入框按 Backspace）">
            撤销
          </button>
          <button type="button" className="btn btn-sm" onClick={redo} disabled={!future.length} title="重做（Ctrl+Y）">
            重做
          </button>
          <button type="button" className="btn btn-sm" onClick={newGame} title="开始新的一局（Alt+N）">
            新一局
          </button>
          <span className="relative">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowKeys((s) => !s)} aria-expanded={showKeys}>
              快捷键
            </button>
            {showKeys && <Shortcuts />}
          </span>
        </span>
      </div>

      <BanRow {...boardProps} />

      <div className="grid min-h-0 flex-1 grid-cols-[232px_minmax(0,1fr)_232px_minmax(380px,440px)] gap-3">
        <TeamColumn side="blue" {...boardProps} />

        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex h-7 items-center justify-between gap-3 px-1">
            <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px]">
              <span className={`h-2 w-2 rounded-full ${!active ? 'bg-good' : active.side === 'blue' ? 'bg-blue' : 'bg-red'}`} />
              <span className="font-medium">{stepText}</span>
              {draft.cursor && (
                <button type="button" className="text-[12px] text-mute hover:text-blue" onClick={() => setCursor(null)}>
                  回到规则顺序
                </button>
              )}
            </span>
            {notice ? <span className="truncate text-[12.5px] text-warn">{notice}</span> : <span className="truncate text-[12px] text-dim">{MODE_INFO[draft.mode].desc}</span>}
          </div>
          <Picker ref={inputRef} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} items={results.items} available={results.available} onPick={(h) => placeHero(h)} placeholder={placeholder} disabled={!active} />
        </div>

        <TeamColumn side="red" {...boardProps} />

        {/* 推荐面板 */}
        <div className="panel flex min-h-0 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <Segmented<RecTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'pick', label: '选人' },
                { value: 'ban', label: '禁用' },
                { value: 'compare', label: `对比${compare.length ? `(${compare.length})` : ''}` },
                { value: 'matchup', label: '关系' },
                { value: 'play', label: '打法' },
              ]}
            />
            <span className="text-[11px] text-dim">{tab === 'play' ? '通用战术说明' : '推荐分不是胜率'}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {(tab === 'pick' || tab === 'ban') && <div className="mb-2 text-[12.5px] text-sub">{recTitle}</div>}
            {tab === 'pick' && (
              <PickList
                recs={pickRecs}
                limit={limit}
                research={prefs.research}
                compare={compare}
                onToggleCompare={toggleCompare}
                onPick={(h) => placeHero(h, active?.kind === 'pick' ? active : null)}
                canPick={active?.kind === 'pick'}
                emptyText={done ? 'BP已完成。“打法”里有这一局怎么打，“关系”里有两套阵容的克制与配合。' : pickSideFull ? `${SIDE_NAME[side]}已经选满。` : usePool ? '英雄池里没有当前可选的英雄。可以切到“理论最优”。' : '没有可推荐的英雄。'}
              />
            )}
            {tab === 'ban' && (
              <BanList
                recs={banRecs}
                limit={limit}
                research={prefs.research}
                onPick={(h) => placeHero(h, active?.kind === 'ban' ? active : null)}
                canPick={active?.kind === 'ban'}
                emptyText={redTeam.length + blueTeam.length === 0 && !engine.metaScope ? '还没有可用于推荐禁用的信息。' : '对方已选满，或没有值得禁用的目标。'}
              />
            )}
            {tab === 'compare' && <CompareTable recs={pickRecs} ids={compare} onRemove={(id) => setCompare((c) => c.filter((x) => x !== id))} onPick={(h) => placeHero(h, active?.kind === 'pick' ? active : null)} canPick={active?.kind === 'pick'} />}
            {tab === 'matchup' && <Matchup blue={blueTeam} red={redTeam} />}
            {tab === 'play' && <PlaybookView ally={mine ? blueTeam : redTeam} enemy={mine ? redTeam : blueTeam} allyLocks={mine ? blueLocks : redLocks} enemyLocks={mine ? redLocks : blueLocks} compact={!prefs.research} />}
            {tab === 'pick' && pickRecs.length > 0 && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
                推荐分由克制、配合、阵容需求、分路、职业赛热度等分项相加得到，点开每一行可以看到各项来源。没有已核实关系的英雄对不会被假设为克制或配合。
                {!prefs.research && ' 切到“研究”可以看到原文依据。'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
