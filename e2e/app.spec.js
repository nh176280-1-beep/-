import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

test('unconfigured installation explains missing account and disables login', async ({ page }) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'price-setup-browser-'));
  const app = await createApp({ dataDir, secure: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${app.server.address().port}/`);
    await expect(page.locator('#login-error')).toContainText('관리자 계정이 등록되지 않아');
    await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeDisabled();
    await expect(page.getByLabel('직원 아이디', { exact: true })).toBeDisabled();
  } finally {
    await page.close();
    await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); });
    await rm(dataDir, { recursive: true });
  }
});
async function login(page, username = 'browser-staff') {
  await page.goto('/');
  await page.getByLabel('직원 아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill('browser-test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('#app-view')).toBeVisible();
}
test('mobile login, filter, search, favorite, persistence and logout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await expect(page.locator('.price-card')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /관리 설정/ })).toBeHidden();
  await page.getByRole('button', { name: '금천미트', exact: true }).click();
  await expect(page.locator('.price-card')).toHaveCount(2);
  await page.getByLabel('품목 또는 등급 검색').fill('등심');
  await expect(page.locator('.price-card')).toHaveCount(1);
  await expect(page.locator('.price-card')).toContainText('12,345');
  await expect(page.locator('.price-card')).toContainText('100g');
  await page.getByRole('button', { name: '테스트 등심 관심 품목 추가' }).click();
  await page.getByRole('button', { name: '관심 품목', exact: true }).click();
  await expect(page.locator('.price-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.favorite-button.saved')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-prices.png', fullPage: true });
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.locator('#login-view')).toBeVisible();
  expect((await page.request.get('/api/prices')).status()).toBe(401);
  expect(errors).toEqual([]);
});
test('desktop administrator can add and disable an employee', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'browser-admin');
  await page.screenshot({ path: 'test-results/desktop-prices.png', fullPage: true });
  await page.getByRole('button', { name: /관리 설정/ }).click();
  await page.getByLabel('이름', { exact: true }).fill('추가 테스트');
  await page.locator('#add-user-form input[name=username]').fill('new-employee');
  await page.getByLabel('초기 비밀번호').fill('new-employee-password');
  await page.getByRole('button', { name: '직원 추가', exact: true }).click();
  const row = page.locator('.user-row').filter({ hasText: 'new-employee' });
  await expect(row).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: '사용 중지' }).click();
  await expect(row).toContainText('사용 중지');
  await expect(row.getByRole('button')).toHaveCount(0);
});
test('login page has no horizontal overflow at narrow mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('#login-view')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-login.png', fullPage: true });
});
