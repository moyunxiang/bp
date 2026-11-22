// 抓取工具：单线程、限速、重试。所有第三方原始响应只写入 data/raw/（不进仓库）。
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const RAW = resolve(ROOT, 'data/raw');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 全局限速：按“请求发起时刻”排队，并发调用时也保证相邻两次发起至少间隔 minIntervalMs
let nextSlot = 0;
async function takeSlot(minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + minIntervalMs;
  if (slot > now) await sleep(slot - now);
}

export interface FetchOpts {
  encoding?: string; // 'utf-8' | 'gbk'
  retries?: number;
  minIntervalMs?: number; // 两次请求的最小间隔
  timeoutMs?: number;
  init?: RequestInit;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { encoding = 'utf-8', retries = 4, minIntervalMs = 1000, timeoutMs = 20000, init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await takeSlot(minIntervalMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url}`) as Error & { status?: number };
        err.status = res.status;
        // 4xx（除429外）重试没有意义
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
        throw err;
      }
      const buf = await res.arrayBuffer();
      return new TextDecoder(encoding).decode(buf);
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeFileSafe(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // 先写临时文件再改名，避免中断留下半截文件
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

export async function writeJson(path: string, data: unknown, pretty = true): Promise<void> {
  await writeFileSafe(path, pretty ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data));
}

/** 带本地缓存的抓取：已有缓存且未要求刷新时直接读取。 */
export async function fetchCached(
  url: string,
  cachePath: string,
  opts: FetchOpts & { refresh?: boolean } = {},
): Promise<{ text: string; fromCache: boolean }> {
  if (!opts.refresh && (await exists(cachePath))) {
    return { text: await readFile(cachePath, 'utf-8'), fromCache: true };
  }
  const text = await fetchText(url, opts);
  await writeFileSafe(cachePath, text);
  return { text, fromCache: false };
}

export function hktNow(): string {
  // 形如 2026-11-22 14:30 HKT
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' HKT';
}
