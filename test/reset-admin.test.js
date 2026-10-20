import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetAdmin } from '../reset-admin.mjs';
import { createAuth } from '../src/auth.js';
import { createStore } from '../src/store.js';

test('offline reset preserves staff and prices, replaces admin password and invalidates old sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'admin-reset-'));
  try {
    const store = createStore(directory), auth = createAuth(store);
    await auth.addUser('admin', '관리자', 'old-test-password', 'admin');
    await auth.addUser('staff', '직원', 'staff-test-password', 'staff');
    store.write('prices', { ekcm: { items: [{ price: 12345 }] } });
    const prices = readFileSync(join(directory, 'prices.json'), 'utf8');
    const staff = auth.users().find(user => user.username === 'staff');
    const session = await auth.login('admin', 'old-test-password');
    const result = resetAdmin(directory);
    assert.equal(result.username, 'admin');
    assert.ok(result.password.length >= 12);
    assert.equal(await auth.login('admin', 'old-test-password'), null);
    assert.ok(await auth.login('admin', result.password));
    assert.equal(auth.getUser(session.cookie), null);
    assert.deepEqual(auth.users().find(user => user.username === 'staff'), staff);
    assert.equal(readFileSync(join(directory, 'prices.json'), 'utf8'), prices);
    assert.ok(!readFileSync(join(directory, 'users.json'), 'utf8').includes(result.password));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('reset refuses to create a replacement database in the wrong folder', () => {
  assert.throws(() => resetAdmin('/nonexistent-price-board-folder'), /기존 계정 파일/);
});
