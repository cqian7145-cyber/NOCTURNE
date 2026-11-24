import { expect, test, type Page } from '@playwright/test';

const monday = new Date('2026-11-23T02:00:00Z');
const homeTitle = 'Make today count.';
const names = ['英语学习', '阅读', '健身'];

function navigation(page: Page) {
  return page.getByRole('navigation', { name: '主导航' });
}

async function addHabit(page: Page, name: string, options: { start?: string; reminder?: string } = {}) {
  await page.getByRole('button', { name: '新建习惯', exact: true }).click();
  const form = page.getByRole('dialog', { name: '创建习惯' });
  const preset = form.getByRole('button', { name, exact: true });
  if (await preset.count()) await preset.click();
  else await form.getByRole('textbox', { name: '习惯名称' }).fill(name);
  if (options.start) await form.getByLabel('开始日期').fill(options.start);
  if (options.reminder) {
    await form.getByLabel('定时提醒').check();
    await form.getByLabel('提醒时间').fill(options.reminder);
  }
  await form.getByRole('button', { name: '保存习惯' }).click();
  await expect(form).toBeHidden();
}

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: homeTitle })).toBeVisible();
}

test('first run, three habits, check, reload, shared analytics, calendar and undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.clock.setFixedTime(monday);
  await openHome(page);
  await expect(page.getByText('从一个习惯开始')).toBeVisible();
  await expect(page.getByText('暂无计划', { exact: true })).toBeVisible();
  for (const name of names) await addHabit(page, name);

  await page.getByRole('button', { name: '完成打卡 英语学习' }).click();
  await expect(page.locator('.ring-number')).toHaveText('1 / 3');
  await expect(page.locator('.ring-caption')).toHaveText('33.3%');
  await page.reload();
  await expect(page.getByRole('button', { name: '撤销打卡 英语学习' })).toBeVisible();

  await navigation(page).getByRole('link', { name: '日历' }).click();
  await expect(page.getByRole('heading', { name: '日历', exact: true })).toBeVisible();
  await expect(page.locator('.calendar-details')).toContainText('1 / 3 项');
  await expect(page.locator('.calendar-details')).toContainText('录入于');
  const selected = page.locator('.calendar-day[aria-current="date"]');
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.calendar-details')).toContainText('到当天即可打卡');
  await expect(page.locator('.calendar-details').getByRole('button', { name: /打卡/ })).toHaveCount(0);

  await navigation(page).getByRole('link', { name: '数据洞察' }).click();
  const summary = page.getByRole('region', { name: '周期概况' });
  await expect(summary).toContainText('33.3%');
  await expect(page.locator('.heat-cell[data-today="true"]')).toHaveAttribute('data-level', 'level-2');
  await page.getByText('查看图表数据', { exact: true }).first().click();
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /2026-11-23 3 1 33.3%/ })).toHaveCount(1);

  await navigation(page).getByRole('link', { name: '今日总览' }).click();
  await page.getByRole('button', { name: '撤销打卡 英语学习' }).click();
  await expect(page.locator('.ring-number')).toHaveText('0 / 3');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.ring-number')).toHaveText('1 / 3');
  expect(errors).toEqual([]);
});

test('historical entry timestamps and a live update in a second tab', async ({ context, page }) => {
  await page.clock.setFixedTime(monday);
  await openHome(page);
  await addHabit(page, '阅读', { start: '2026-11-21' });
  const other = await context.newPage();
  await other.goto('/#/analytics');
  await expect(other.getByRole('heading', { name: '数据洞察' })).toBeVisible();
  await page.goto('/#/calendar?date=2026-11-21');
  await page.getByRole('button', { name: '完成打卡 阅读' }).click();
  await expect(page.locator('.date-rollup')).toContainText('1 / 1 项');
  await expect(page.locator('.entry-time')).toContainText('11月23日');
  await expect(other.getByRole('region', { name: '周期概况' })).toContainText('33.3%');
  await other.close();

  await navigation(page).getByRole('link', { name: '设置' }).click();
  await page.getByRole('button', { name: '归档 阅读' }).click();
  await expect(page.getByRole('button', { name: '恢复 阅读' })).toBeVisible();
  await page.goto('/#/calendar?date=2026-11-21');
  await expect(page.getByRole('button', { name: '撤销打卡 阅读' })).toBeVisible();
});

test('goal progress follows checks and weekly/monthly notes survive reload', async ({ page }) => {
  await page.clock.setFixedTime(monday);
  await openHome(page);
  await addHabit(page, '阅读');
  await navigation(page).getByRole('link', { name: '目标' }).click();
  await page.getByRole('button', { name: '新建目标' }).click();
  const form = page.getByRole('dialog', { name: '创建目标' });
  await form.getByLabel('目标名称').fill('读完一章');
  await form.getByLabel('目标打卡次数').fill('1');
  await form.getByRole('button', { name: '保存目标' }).click();
  await expect(page.getByRole('progressbar', { name: '读完一章 进度' })).toHaveAttribute('aria-valuenow', '0');

  await navigation(page).getByRole('link', { name: '今日总览' }).click();
  await page.getByRole('button', { name: '完成打卡 阅读' }).click();
  await expect(page.locator('.ring-caption')).toHaveText('100%');
  await navigation(page).getByRole('link', { name: '目标' }).click();
  await expect(page.getByRole('progressbar', { name: '读完一章 进度' })).toHaveAttribute('aria-valuenow', '100');

  await navigation(page).getByRole('link', { name: '复盘' }).click();
  await expect(page.locator('.report-numbers')).toContainText('100%');
  const reflection = '醒来先读一段。';
  await page.getByLabel('这周做得最好的是什么？').fill(reflection);
  await page.getByRole('button', { name: '保存反思' }).click();
  await expect(page.getByRole('button', { name: '保存反思' })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('这周做得最好的是什么？')).toHaveValue(reflection);
  await page.getByRole('button', { name: '月报', exact: true }).click();
  await expect(page.getByRole('heading', { name: '习惯完成排名' })).toBeVisible();
  await expect(page.locator('.review-goals')).toContainText('读完一章');
});

test('resumes a saved paused timer, records only one session and supports rest', async ({ page }) => {
  await page.clock.install({ time: monday });
  await page.goto('/#/focus');
  const number = page.getByLabel('剩余时间');
  await expect(number).toHaveText('25:00');
  await page.getByLabel('时长（分钟）').fill('1');
  await page.getByRole('button', { name: '开始专注' }).click();
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();
  await page.clock.fastForward(12_000);
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
  const paused = await number.innerText();
  expect(paused).toMatch(/^00:4\d$/);
  await page.reload();
  await expect(number).toHaveText(paused);
  await page.clock.fastForward(30_000);
  await expect(number).toHaveText(paused);
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.locator('.session-list li')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.session-list li')).toHaveCount(1);
  await page.getByRole('button', { name: '短休息' }).click();
  await expect(number).toHaveText('05:00');
  await page.getByRole('button', { name: '开始休息' }).click();
  await expect(page.getByRole('button', { name: '重置' })).toBeVisible();
  await page.getByRole('button', { name: '重置' }).click();
  await expect(page.getByRole('button', { name: '开始休息' })).toBeVisible();
});

test('validates backups, downloads, gates clear, and restores via the preview', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(monday);
  await openHome(page);
  await addHabit(page, '阅读');
  await page.getByRole('button', { name: '完成打卡 阅读' }).click();
  await expect(page.locator('.ring-caption')).toHaveText('100%');
  await navigation(page).getByRole('link', { name: '设置' }).click();

  const backupInput = page.getByLabel('选择 JSON 备份');
  await backupInput.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('请选择有效的 JSON 备份');
  await expect(page.getByText('阅读', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('NOCTURNE-2026-11-23.json');
  const path = testInfo.outputPath('backup.json');
  await download.saveAs(path);

  await page.getByRole('button', { name: '清空数据' }).click();
  const clear = page.getByRole('dialog', { name: '清空本地数据' });
  await expect(clear.getByRole('button', { name: '确认清空' })).toBeDisabled();
  await clear.getByRole('textbox', { name: '输入「清空」确认' }).fill('清空');
  await clear.getByRole('button', { name: '确认清空' }).click();
  await expect(page.getByText('没有进行中的习惯')).toBeVisible();

  await backupInput.setInputFiles(path);
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible();
  await page.getByText('完全替换，包括偏好和计时状态').click();
  await page.getByRole('button', { name: '继续替换' }).click();
  await page.getByRole('dialog', { name: '替换本地记录' }).getByRole('button', { name: '确认替换' }).click();
  await expect(page.getByText('阅读', { exact: true })).toBeVisible();
  await navigation(page).getByRole('link', { name: '今日总览' }).click();
  await expect(page.locator('.ring-caption')).toHaveText('100%');
});

test('shows both in-app and permitted browser reminders for a due habit', async ({ context, page }) => {
  await page.clock.setFixedTime(monday);
  await context.grantPermissions(['notifications']);
  await openHome(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await addHabit(page, '上午提醒', { reminder: '09:00' });
  await expect(page.getByText('上午提醒还没打卡。')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = await registration?.getNotifications({ tag: 'nocturne-2026-11-23' });
    return notifications?.map(notification => notification.body);
  })).toEqual(['上午提醒还没打卡。']);
  await page.reload();
  await expect(page.getByRole('button', { name: '完成打卡 上午提醒' })).toBeVisible();
  await expect(page.getByText('上午提醒还没打卡。')).toHaveCount(0);
});

test('reopens the production build offline and keeps the same local records', async ({ context, page }) => {
  await page.clock.setFixedTime(monday);
  await openHome(page);
  await addHabit(page, '阅读');
  await page.getByRole('button', { name: '完成打卡 阅读' }).click();
  await expect(page.locator('.ring-caption')).toHaveText('100%');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '撤销打卡 阅读' })).toBeVisible();
  await navigation(page).getByRole('link', { name: '数据洞察' }).click();
  await expect(page.getByRole('region', { name: '周期概况' })).toContainText('100%');
});

test('storage errors show a recoverable application state', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '本地日志无法打开' })).toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { name: '本地日志无法打开' })).toBeVisible();
});

test('five viewports, accessible heatmap keyboard navigation and reduced motion', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(monday);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await addHabit(page, '阅读');
  await addHabit(page, '每天把读到的一小段材料写成自己的语言并回顾已经完成的任务以便下次可以从更清楚的地方继续');
  await addHabit(page, '健身');
  await page.getByRole('button', { name: '完成打卡 阅读' }).click();
  await expect(page.locator('.ring-caption')).toHaveText('33.3%');
  await expect(page.locator('.application')).toHaveAttribute('data-reduced', 'true');
  const heatToday = page.locator('.heat-cell[data-today="true"]');
  await heatToday.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: '查看日历' })).toBeVisible();
  await page.keyboard.press('Enter');

  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    await openHome(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath('dashboard-' + width + '.png'), fullPage: true });
  }

  const mobile = page.getByRole('navigation', { name: '移动导航' });
  await expect(mobile).toBeVisible();
  await mobile.getByRole('link', { name: '日历' }).click();
  await expect(page.getByRole('heading', { name: '日历', exact: true })).toBeVisible();
  await page.locator('.calendar-day[aria-current="date"]').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: '撤销打卡 阅读' })).toBeVisible();
  await sheet.getByRole('button', { name: '关闭' }).click();
  await mobile.getByRole('button', { name: '更多' }).click();
  await page.getByRole('navigation', { name: '更多导航' }).getByRole('link', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});
