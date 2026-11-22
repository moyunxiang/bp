// 开发辅助：用本机 Chrome 以桌面宽度打开页面并截图，同时收集控制台报错。
// 用法：tsx scripts/shot.ts <输出png> <hash路径> [--keys="a b Enter"] [--type=文本] [--full] [--w=1440] [--h=900] [--click=文字] [--wait=毫秒]
import { chromium } from '@playwright/test';

const [out, route = '/'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5183/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: Number(arg('w') ?? 1440), height: Number(arg('h') ?? 900) }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${base}#${route}`, { waitUntil: 'networkidle' });
// 依次执行动作：--steps 用 | 分隔，支持 type:文本 / key:按键 / click:文字 / wait:毫秒 / scroll:像素
for (const step of (arg('steps') ?? '').split('|').filter(Boolean)) {
  const [kind, ...rest] = step.split(':');
  const value = rest.join(':');
  if (kind === 'type') await page.keyboard.type(value, { delay: 20 });
  else if (kind === 'key') await page.keyboard.press(value);
  else if (kind === 'click') await page.getByText(value, { exact: true }).first().click();
  else if (kind === 'wait') await page.waitForTimeout(Number(value));
  else if (kind === 'scroll') await page.mouse.wheel(0, Number(value));
}
await page.waitForTimeout(Number(arg('wait') ?? 500));
await page.screenshot({ path: out, fullPage: process.argv.includes('--full') });
console.log(errors.length ? `控制台报错 ${errors.length} 条：\n${errors.slice(0, 10).join('\n')}` : '控制台无报错');
await browser.close();
