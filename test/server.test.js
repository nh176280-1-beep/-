import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

test('fresh installation reports setup required instead of incorrect credentials', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'price-unconfigured-'));
  const app = await createApp({ dataDir, secure: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await rm(dataDir, { recursive: true }); });
  const status = await fetch(base + '/api/me');
  assert.equal(status.status, 503);
  assert.equal((await status.json()).code, 'SETUP_REQUIRED');
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'admin', password: 'test-only-password' }) });
  assert.equal(login.status, 503);
  assert.equal((await login.json()).code, 'SETUP_REQUIRED');
  assert.equal((await fetch(base + '/api/prices')).status, 401);
  await app.auth.addUser('manager', '관리자', 'test-only-password', 'admin');
  assert.equal((await fetch(base + '/api/me')).status, 401);
});

async function fixture(t, fetcher) {
  const dataDir = await mkdtemp(join(tmpdir(), 'price-test-'));
  const app = await createApp({ dataDir, secure: false, fetcher });
  await app.auth.addUser('manager', '테스트 관리자', 'valid-test-password', 'admin');
  await app.auth.addUser('worker', '테스트 직원', 'valid-test-password', 'staff');
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await rm(dataDir, { recursive: true }); });
  const request = (path, data, cookie, origin = base) => fetch(base + path, { ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}), headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  const login = async (username = 'manager') => (await request('/api/login', { username, password: 'valid-test-password' })).headers.get('set-cookie').split(';')[0];
  return { ...app, base, request, login, dataDir };
}
test('private API requires login and cookies protect sessions', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/prices')).status, 401);
  assert.equal((await app.request('/api/login', { username: 'worker', password: 'wrong' })).status, 401);
  const response = await app.request('/api/login', { username: 'worker', password: 'valid-test-password' });
  assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/api/prices', null, cookie)).status, 200);
  assert.equal((await app.request('/api/users', null, cookie)).status, 403);
  assert.equal((await app.request('/api/refresh', {}, cookie)).status, 403);
  assert.equal((await app.request('/api/me', null, cookie + 'tampered')).status, 401);
  await app.request('/api/logout', {}, cookie);
  assert.equal((await app.request('/api/me', null, cookie)).status, 401);
});
test('admin creates and disables staff; plaintext passwords never returned or stored', async t => {
  const app = await fixture(t); const cookie = await app.login();
  const created = await app.request('/api/users', { username: 'employee', name: '직원', password: 'new-user-password' }, cookie);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.hash, undefined);
  assert.ok(!JSON.stringify(app.store.read('users')).includes('new-user-password'));
  const login = await app.request('/api/login', { username: 'employee', password: 'new-user-password' });
  const employeeCookie = login.headers.get('set-cookie').split(';')[0];
  await app.request('/api/users/disable', { username: 'employee' }, cookie);
  assert.equal((await app.request('/api/me', null, employeeCookie)).status, 401);
  assert.equal((await app.request('/api/users/reset', { username: 'employee', password: 'replacement-password' }, cookie)).status, 200);
  assert.equal((await app.request('/api/login', { username: 'employee', password: 'new-user-password' })).status, 401);
  assert.equal((await app.request('/api/login', { username: 'employee', password: 'replacement-password' })).status, 200);
  assert.equal((await app.request('/api/me', null, employeeCookie)).status, 401);
});
test('rejects cross-origin mutations, bad URLs and short passwords', async t => {
  const app = await fixture(t); const cookie = await app.login();
  assert.equal((await app.request('/api/users', {}, cookie, 'https://attacker.example')).status, 403);
  assert.equal((await app.request('/api/sources', { id: 'ekcm', url: 'https://localhost/' }, cookie)).status, 400);
  assert.equal((await app.request('/api/users', { username: 'newuser', password: 'short' }, cookie)).status, 400);
});
test('login rate limit stops repeated guesses', async t => {
  const app = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await app.request('/api/login', { username: 'worker', password: 'wrong' })).status, 401);
  assert.equal((await app.request('/api/login', { username: 'worker', password: 'valid-test-password' })).status, 429);
});
test('collector saves prices, preserves last success on failure and persists after restart', async t => {
  let fail = false;
  const fetcher = async url => {
    if (fail) throw new Error('fetch failed');
    if (url.endsWith('robots.txt')) return new Response('User-agent: *\nAllow: /');
    return new Response('<script type="application/ld+json">{"@type":"Product","name":"테스트용 등심","offers":{"price":12345,"priceCurrency":"KRW"}}</script>');
  };
  const app = await fixture(t, fetcher);
  await app.collector.refresh({ force: true });
  assert.equal(app.collector.state()[0].items[0].price, 12345);
  const timestamp = app.collector.state()[0].lastSuccess;
  fail = true; await app.collector.refresh({ force: true });
  assert.equal(app.collector.state()[0].status, 'error');
  assert.equal(app.collector.state()[0].lastSuccess, timestamp);
  assert.equal(app.collector.state()[0].items[0].price, 12345);
  const restarted = await createApp({ dataDir: app.dataDir, secure: false, fetcher });
  assert.equal(restarted.collector.state()[0].items[0].price, 12345);
  assert.equal(restarted.auth.users().length, 2);
});
test('robots disallow prevents fetching price page', async t => {
  let pageCalls = 0;
  const app = await fixture(t, async url => {
    if (url.endsWith('robots.txt')) return new Response('User-agent: *\nDisallow: /');
    pageCalls++; return new Response('');
  });
  await app.collector.refresh({ force: true });
  assert.equal(pageCalls, 0); assert.match(app.collector.state()[0].message, /robots/);
});
test('unsupported page does not fabricate prices', async t => {
  const app = await fixture(t, async url => new Response(url.endsWith('robots.txt') ? '' : '<h1>로그인 후 가격 확인</h1>'));
  await app.collector.refresh({ force: true });
  assert.equal(app.collector.state()[0].items.length, 0); assert.equal(app.collector.state()[0].status, 'error');
});
test('admin refresh returns promptly while full collection continues in the background', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, async url => {
    await gate;
    return new Response(url.endsWith('/robots.txt') ? '' : '<script type="application/ld+json">{"@type":"Product","name":"테스트 상품","offers":{"price":12345,"priceCurrency":"KRW"}}</script>');
  });
  try {
    const cookie = await app.login();
    const response = await app.request('/api/refresh', {}, cookie);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).refreshing, true);
    assert.equal(app.collector.running, true);
    assert.equal(app.collector.state()[0].collecting, true);
  } finally {
    release();
    await app.collector.refresh();
  }
  assert.equal(app.collector.state()[0].collecting, false);
});
