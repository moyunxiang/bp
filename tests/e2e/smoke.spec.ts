// 冒烟测试：关键页面能打开、BP主流程可以只用键盘走完。
import { expect, test, type Page } from '@playwright/test';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // 头像等外链图片在测试环境里可能加载失败，不算页面错误
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return errors;
}

async function typeHero(page: Page, text: string) {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

const BANS = ['lubandashi', 'dunshan', 'aoyin', 'zhaoyun', 'haiyue', 'xialuote', 'shenmengxi', 'guanyu', 'zhongkui', 'kuangtie'];
// 排位选人顺序：蓝1 红1 红2 蓝2 蓝3 红3 红4 蓝4 蓝5 红5
const PICKS = ['makeboluo', 'houyi', 'zhangfei', 'caiwenji', 'lianpo', 'daji', 'libai', 'lanlingwang', 'diaochan', 'yase'];

test('BP助手：纯键盘录完一局（10禁10选），推荐随之更新，可撤销', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByLabel('搜索英雄')).toBeFocused();
  await expect(page.getByText('蓝方（我方）禁用第1个')).toBeVisible();
  // 禁用阶段显示禁用推荐
  await expect(page.getByText('为蓝方（我方）推荐禁用')).toBeVisible();

  for (const b of BANS) await typeHero(page, b);
  await expect(page.getByLabel('蓝方禁用：鲁班大师')).toBeVisible();
  await expect(page.getByLabel('红方禁用：狂铁')).toBeVisible();
  await expect(page.getByText('蓝方（我方）1楼选人')).toBeVisible();
  await expect(page.getByText('为蓝方（我方）推荐选人')).toBeVisible();
  // 被禁的英雄不会出现在推荐里
  await expect(page.getByRole('button', { name: '选用' }).first()).toBeVisible();

  // 输入框为空时按数字键直接采用推荐；Backspace 撤销
  await page.keyboard.press('1');
  await expect(page.getByLabel(/^蓝方1楼：.+/)).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(page.getByLabel('蓝方1楼（空）')).toBeVisible();

  for (const p of PICKS) await typeHero(page, p);
  await expect(page.getByLabel('蓝方1楼：马可波罗')).toBeVisible();
  await expect(page.getByLabel('红方2楼：张飞')).toBeVisible();
  await expect(page.getByLabel('蓝方5楼：貂蝉')).toBeVisible();
  await expect(page.getByLabel('红方5楼：亚瑟')).toBeVisible();
  await expect(page.getByText('BP已完成').first()).toBeVisible();

  // 已选英雄不能再选：换到一个位置后输入已选英雄会被拒绝
  await page.getByLabel('红方5楼：亚瑟').click();
  await typeHero(page, 'makeboluo');
  await expect(page.getByText(/马可波罗在这个位置不可用/)).toBeVisible();
  await expect(page.getByLabel('红方5楼：亚瑟')).toBeVisible();

  // 选满后自动切到“打法”：我方怎么打、对面的突破口、要防的点、分路对位
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const play = page.getByTestId('playbook');
  await expect(play).toBeVisible();
  for (const title of ['我方怎么打', '对面的突破口', '要防的点', '分路对位']) await expect(play.getByRole('heading', { name: title })).toBeVisible();
  await expect(play.locator('[data-play-lane]')).toHaveCount(5);
  // 对面后羿能照出隐身，我方兰陵王会被提醒；点开能看到技能原文依据
  const danger = play.locator('[data-play="danger_reveal"]');
  await expect(danger).toContainText('兰陵王');
  await danger.getByRole('button').click();
  await expect(danger).toContainText('依据的通用机制');
  await expect(danger.locator('.quote').first()).toBeVisible();

  // 双方关系图
  await page.getByRole('button', { name: '关系', exact: true }).click();
  await expect(page.locator('svg').filter({ hasText: '马可波罗' }).first()).toBeVisible();

  // 刷新后保留当前BP
  await page.reload();
  await expect(page.getByLabel('蓝方1楼：马可波罗')).toBeVisible();
  expect(errors).toEqual([]);
});

test('BP助手：研究模式能展开依据；候选对比', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByLabel('每方禁用').selectOption('0');
  await typeHero(page, 'makeboluo'); // 蓝1
  await expect(page.getByText('红方（对方）1楼选人')).toBeVisible();
  await page.getByRole('button', { name: '研究' }).click();
  // 盾山对马可波罗有“阻挡飞行物”的机制关系
  const row = page.locator('li').filter({ hasText: '盾山' }).first();
  await row.getByRole('button', { expanded: false }).first().click();
  await expect(row.getByText(/克制马可波罗/).first()).toBeVisible();
  await row.getByRole('button', { name: '依据' }).first().click();
  await expect(row.getByText(/成立条件/).first()).toBeVisible();

  // 把前两个候选加入对比（列表里的“对比”按钮，不是面板上方的标签页）
  const list = page.locator('ol > li');
  await list.nth(0).getByRole('button', { name: '对比', exact: true }).click();
  await list.nth(1).getByRole('button', { name: '对比', exact: true }).click();
  await expect(list.nth(0).getByRole('button', { name: '已加入' })).toBeVisible();
  await page.getByRole('button', { name: '对比(2)', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('克制与被克').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('BP助手：选人时提示我方阵容还缺什么，推荐理由里说明能补上', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByLabel('每方禁用').selectOption('0');
  // 蓝1 孙尚香，红1 后羿，红2 张飞，蓝2 貂蝉 → 轮到蓝3：我方两个人里没有坦克或战士
  for (const h of ['sunshangxiang', 'houyi', 'zhangfei', 'diaochan']) await typeHero(page, h);
  await expect(page.getByText('蓝方（我方）3楼选人')).toBeVisible();
  const gaps = page.getByTestId('team-gaps');
  await expect(gaps).toContainText('我方还缺');
  await expect(gaps).toContainText('坦克或战士');
  await expect(gaps).toContainText('还剩3个位置');
  await page.getByRole('button', { name: '研究' }).click();
  await expect(page.getByText(/本方没有坦克或战士，它能补上/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('英雄池：加入后BP助手可以只在池内推荐', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/me');
  await page.getByPlaceholder(/搜索英雄/).first().fill('蔡文姬');
  await page.getByTitle('蔡文姬：点击加入英雄池').first().click();
  await expect(page.getByTitle(/蔡文姬：熟练度 1/).first()).toBeVisible();

  await page.goto('./#/');
  await page.getByLabel('每方禁用').selectOption('0');
  await page.getByRole('button', { name: /我的英雄池\(1\)/ }).click();
  await expect(page.getByText(/仅我的英雄池/)).toBeVisible();
  await expect(page.getByRole('button', { name: '选用' })).toHaveCount(1);
  await expect(page.locator('ol li').filter({ hasText: '蔡文姬' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('英雄百科：搜索、详情、关系依据', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/heroes');
  await page.getByRole('textbox').first().fill('猴子');
  await expect(page.getByText('孙悟空').first()).toBeVisible();
  await page.goto('./#/heroes/105');
  await expect(page.getByRole('heading', { name: '廉颇' }).first()).toBeVisible();
  await expect(page.getByText('爆裂冲撞').first()).toBeVisible();
  await expect(page.getByText(/官方原文/).first()).toBeVisible();
  // 官方关系：后羿克制廉颇
  await expect(page.getByText('后羿').first()).toBeVisible();
  await page.goto('./#/heroes/999999');
  await expect(page.getByText('没有这个英雄')).toBeVisible();
  expect(errors).toEqual([]);
});

test('英雄百科：连招与细节带视频出处，出装带图标', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/heroes/131');
  const guide = page.locator('#guide');
  await expect(guide.getByRole('heading', { name: '连招与细节' })).toBeVisible();
  await expect(guide.getByText(/官方技能顺序/)).toBeVisible();
  // 至少一条连招，且每条出处都是带时间点的B站链接
  const links = guide.locator('a[href^="https://www.bilibili.com/video/BV"]');
  expect(await links.count()).toBeGreaterThan(3);
  expect(await links.first().getAttribute('href')).toMatch(/\?t=\d+$/);
  await expect(guide.getByText('将进酒').first()).toBeVisible();
  // 出装图标来自官方地址
  expect(await page.locator('#builds img[src*="/itemimg/"]').count()).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('数据说明：展示选人模型的系数和回测', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/about');
  const model = page.locator('#about-model');
  await expect(model.getByText(/条件logit/)).toBeVisible();
  await expect(model.getByText('职业赛该位置选取（近60天）').first()).toBeVisible();
  // 胜负检验：阵容差值与职业赛胜负的关系
  await expect(page.locator('#about-outcome')).toContainText('队伍Elo差');
  await expect(page.locator('#about-backtest').getByText(/线上使用/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('关系图谱：单英雄图与阵容对阵', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/graph?hero=509');
  await expect(page.locator('svg').filter({ hasText: '盾山' }).first()).toBeVisible();
  await page.goto('./#/graph?mode=team&blue=132,184,105&red=509,169');
  await expect(page.locator('svg').filter({ hasText: '马可波罗' }).first()).toBeVisible();
  await expect(page.getByText(/蓝方克制红方/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('阵容库：体系、职业赛阵容、自定义阵容', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/comps');
  await expect(page.getByText('强开团').first()).toBeVisible();
  await expect(page.getByText(/不是数据结论/).first()).toBeVisible();
  await page.getByRole('button', { name: /职业赛阵容/ }).click();
  await expect(page.getByText(/不是胜率/).first()).toBeVisible();
  await page.getByRole('button', { name: /我的阵容/ }).click();
  await expect(page.getByText(/浏览器/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('阵容库：体系和阵容都有局内打法，阵容对比给出对阵打法', async ({ page }) => {
  const errors = watchErrors(page);
  // 体系页：分阶段打法和应对办法
  await page.goto('./#/comps?tab=archetypes&arch=engage');
  const arch = page.getByTestId('arch-play');
  for (const t of ['局内怎么打', '前期', '中期', '团战', '不要做', '对面是这个体系时怎么打']) await expect(arch.getByText(t, { exact: true })).toBeVisible();

  // 阵容对比：马可波罗 蔡文姬 廉颇 兰陵王 貂蝉 对 后羿 张飞 妲己 李白 亚瑟
  await page.goto('./#/comps?tab=compare&a=132-184-105-153-141&b=169-171-109-131-166');
  const play = page.locator('#compare-play');
  await expect(play.getByRole('heading', { name: '对阵打法' })).toBeVisible();
  await expect(play.locator('[data-play="plan_stealth"]')).toContainText('兰陵王');
  await expect(play.locator('[data-play-against="engage"]')).toBeVisible();
  await expect(play.locator('[data-play="open_protector"]')).toContainText('张飞');
  await expect(play.locator('[data-play-lane]')).toHaveCount(5);
  // 换成B的视角：隐身从“我方打法”变成“要防的点”
  await play.getByRole('button', { name: '我是B' }).click();
  await expect(play.locator('[data-play="danger_stealth"]')).toContainText('兰陵王');
  await expect(play.locator('[data-play="plan_stealth"]')).toHaveCount(0);
  await expect(play.locator('[data-play-archetype="engage"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('数据说明：显示更新时间、来源与数量', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/about');
  await expect(page.getByText('数据来源').first()).toBeVisible();
  await expect(page.getByText('机制档案核实').first()).toBeVisible();
  await expect(page.getByText(/不是胜率/).first()).toBeVisible();
  await expect(page.getByText(/npm run update-data/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('BP助手：指定楼层和位置后，轮到自己时只推荐该位置的英雄，并自动锁定分路', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByLabel('每方禁用').selectOption('0');
  await page.getByLabel('我在').selectOption('1');
  await page.getByLabel('我打').selectOption('5'); // 游走
  await expect(page.getByText(/1楼选人 · 轮到你/)).toBeVisible();
  await expect(page.getByText(/推荐选人 · 游走/)).toBeVisible();
  // 推荐列表里每一项的分路标记都是游走
  const rows = page.locator('ol > li');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let i = 0; i < count; i++) await expect(rows.nth(i).getByText('游走', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('1');
  // 我的那一手自动锁定为游走
  await expect(page.getByTitle('已手动指定分路，点击修改')).toBeVisible();
  // 轮到对方时不再限制位置
  await expect(page.getByText('红方（对方）可能的选择')).toBeVisible();
  // Alt+数字修改刚选英雄的分路
  await page.keyboard.press('Alt+Digit1');
  await expect(page.getByTitle('已手动指定分路，点击修改').getByText('对抗')).toBeVisible();
  expect(errors).toEqual([]);
});

test('分路梯度：营地各段位与职业赛可以切换', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/tiers');
  await expect(page.getByRole('heading', { name: '各分路梯度' })).toBeVisible();
  // 默认是营地的巅峰赛数据：5个位置，每个位置至少5个英雄，带胜率
  await expect(page.getByTestId('tiers-note')).toContainText('王者营地');
  await expect(page.locator('section[data-lane]')).toHaveCount(5);
  expect(await page.locator('section[data-lane="2"] a[href*="/heroes/"]').count()).toBeGreaterThanOrEqual(5);
  await expect(page.locator('section[data-lane="2"]').getByText(/胜率 \d+\.\d%/).first()).toBeVisible();
  // 切到职业赛：说明换成“不是路人局强度”，地址带上来源
  await page.locator('button[data-src="kpl"]').click();
  await expect(page.getByTestId('tiers-note')).toContainText('不是路人局强度');
  await expect(page).toHaveURL(/src=kpl/);
  expect(await page.locator('section[data-lane="2"] a[href*="/heroes/"]').count()).toBeGreaterThanOrEqual(5);
  expect(errors).toEqual([]);
});
