// 读取 .env.local（不进仓库）。只返回值，不打印，避免凭据进入日志。
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { ROOT } from './http.ts';

export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = resolve(ROOT, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const k of ['BILI_COOKIE']) if (process.env[k]) out[k] = process.env[k]!;
  return out;
}

/** B站请求头。Cookie 只放进请求头，不写入任何文件或输出。 */
export function biliHeaders(cookie: string | undefined): Record<string, string> {
  return { Referer: 'https://www.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}) };
}
