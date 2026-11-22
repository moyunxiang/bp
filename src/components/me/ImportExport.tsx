import { useState } from 'react';
import { useUser, exportProfile, type Profile } from '../../lib/userStore.ts';

export function ImportExport() {
  const pool = useUser((s) => s.pool);
  const prefs = useUser((s) => s.prefs);
  const favoriteHeroes = useUser((s) => s.favoriteHeroes);
  const favoriteComps = useUser((s) => s.favoriteComps);
  const customComps = useUser((s) => s.customComps);
  const importProfile = useUser((s) => s.importProfile);
  const resetToRepo = useUser((s) => s.resetToRepo);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);

  const json = () => exportProfile({ pool, prefs, favoriteHeroes, favoriteComps, customComps });

  const download = () => {
    const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'profile.json';
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ ok: true, text: '已开始下载 profile.json。' });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setMsg({ ok: true, text: '已复制到剪贴板。' });
    } catch {
      setMsg({ ok: false, text: '复制失败（浏览器未授权剪贴板），请改用下载。' });
    }
  };
  const doImport = (src: string) => {
    let data: unknown;
    try {
      data = JSON.parse(src);
    } catch (e) {
      setMsg({ ok: false, text: `导入失败：不是有效的 JSON（${(e as Error).message}）` });
      return;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      setMsg({ ok: false, text: '导入失败：内容应为一个 JSON 对象（profile.json 的格式）。' });
      return;
    }
    const p = data as Partial<Profile>;
    if (!['pool', 'prefs', 'favoriteHeroes', 'favoriteComps', 'customComps'].some((k) => k in p)) {
      setMsg({ ok: false, text: '导入失败：没有找到 pool、prefs、favoriteHeroes 等字段，不像是导出的 profile。' });
      return;
    }
    importProfile(p);
    setMsg({ ok: true, text: '导入成功，已覆盖对应的字段。' });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const t = await f.text();
      setText(t);
      doImport(t);
    } catch {
      setMsg({ ok: false, text: '导入失败：读取文件出错。' });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-panel2 p-3 text-[12.5px] leading-relaxed text-sub">
        你的英雄池、偏好、收藏和自定义阵容保存在这台电脑的浏览器里。想长期保留或换电脑使用：先在这里导出，用导出的文件覆盖仓库里的 <span className="kbd">user/profile.json</span> 并提交，网站重新发布后会以它作为默认值。清除浏览器数据会丢失本地保存的内容。
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink">导出</div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={download}>下载 profile.json</button>
          <button className="btn" onClick={copy}>复制到剪贴板</button>
        </div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink">导入</div>
        <textarea className="input h-28 w-full font-mono text-[12px]" placeholder="粘贴 profile.json 的内容" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn btn-primary" onClick={() => doImport(text)} disabled={!text.trim()}>导入粘贴的内容</button>
          <label className="btn cursor-pointer">
            选择文件导入
            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {msg && <div role="status" className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>{msg.text}</div>}
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink">恢复为仓库中的版本</div>
        {!confirm ? (
          <button className="btn" onClick={() => setConfirm(true)}>恢复为仓库版本…</button>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-bad/50 bg-bad/10 p-3 text-[13px]">
            <span className="text-bad">这会丢弃浏览器里的全部个人修改，改用仓库 user/profile.json 的内容。确定吗？</span>
            <button className="btn btn-primary" onClick={() => { resetToRepo(); setConfirm(false); setMsg({ ok: true, text: '已恢复为仓库中的版本。' }); }}>确定恢复</button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>取消</button>
          </div>
        )}
      </div>
    </div>
  );
}
