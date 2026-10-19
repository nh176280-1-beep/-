// Isolated test fixtures only. Production never loads this module or these prices.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
const dataDir = await mkdtemp(join(tmpdir(), 'price-browser-'));
const app = await createApp({ dataDir, secure: false, fetcher: async url => {
  if (url.endsWith('robots.txt')) return new Response('User-agent: *\nAllow: /');
  if (url.includes('/empty')) return new Response('<h1>No public prices</h1>');
  return new Response('<table><tr><th>품목</th><th>등급</th><th>중량</th><th>판매가(원)</th></tr><tr><td>테스트 등심</td><td>1++</td><td>100g</td><td>12,345</td></tr><tr><td>테스트 안심</td><td>1+</td><td>1kg</td><td>98,765</td></tr></table>');
} });
await app.auth.addUser('browser-admin', '브라우저 테스트 관리자', 'browser-test-password', 'admin');
await app.auth.addUser('browser-staff', '브라우저 테스트 직원', 'browser-test-password', 'staff');
await app.collector.refresh({ force: true });
app.server.listen(3101, '127.0.0.1');
const stop = () => app.server.close(async () => { await rm(dataDir, { recursive: true }); process.exit(0); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
