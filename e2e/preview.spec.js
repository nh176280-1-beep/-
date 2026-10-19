import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('standalone preview has no network dependencies, filters and saves favorites on mobile', async ({ page, context }) => {
  // Managed Chromium blocks file:// navigation. Fulfill the document from disk;
  // offline mode prevents any real HTTP request or server dependency.
  const previewUrl = 'http://127.0.0.1:3101/offline-preview';
  const html = await readFile(resolve('preview/index.html'), 'utf8');
  await page.route(previewUrl, route => route.fulfill({ contentType: 'text/html', body: html }));
  await context.setOffline(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [], networkRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url() !== previewUrl && /^https?:/.test(request.url())) networkRequests.push(request.url()); });
  await page.goto(previewUrl);
  await expect(page.locator('#app-view')).toBeVisible();
  await expect(page.locator('#login-view')).toBeHidden();
  await expect(page.locator('.preview-banner')).toContainText('실제 판매가가 아닙니다');
  await expect(page.locator('.price-card')).toHaveCount(8);
  await page.getByRole('button', { name: '일품한우', exact: true }).click();
  await expect(page.locator('.price-card')).toHaveCount(4);
  await page.getByLabel('품목 또는 등급 검색').fill('등심');
  await expect(page.locator('.price-card')).toHaveCount(1);
  await expect(page.locator('.price-card')).toContainText('63,000');
  await expect(page.locator('.price-card')).toContainText('실제 판매가 아님');
  await page.getByRole('button', { name: '등심 관심 품목 추가' }).click();
  await page.getByRole('button', { name: '관심 품목', exact: true }).click();
  await expect(page.locator('.price-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.favorite-button.saved')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(networkRequests).toEqual([]);
});
