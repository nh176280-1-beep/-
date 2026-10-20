import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createStore } from './store.js';
import { createAuth } from './auth.js';
import { createCollector } from './collector.js';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const publicUser = ({ username, name, role, disabled }) => ({ username, name, role, disabled: Boolean(disabled) });
export async function createApp(options = {}) {
  const store = createStore(options.dataDir || process.env.DATA_DIR || './data');
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const auth = createAuth(store, secure);
  if (!auth.users().length && process.env.ADMIN_PASSWORD) {
    await auth.addUser(process.env.ADMIN_USERNAME || 'admin', '관리자', process.env.ADMIN_PASSWORD, 'admin');
  }
  const collector = createCollector(store, { fetcher: options.fetcher });
  const attempts = new Map();
  const ipAttempts = new Map();
  function limited(map, key, limit) {
    const now = Date.now();
    for (const [key, item] of map) if (item.until <= now) map.delete(key);
    const entry = map.get(key) || { count: 0, until: now + 15 * 60_000 };
    entry.count++;
    map.set(key, entry);
    return entry.count > limit;
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 16_384) throw Object.assign(new Error('요청 크기가 너무 큽니다.'), { status: 413 });
    }
    try {
      const value = JSON.parse(text || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw Object.assign(new Error('잘못된 요청 형식입니다.'), { status: 400 }); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/health') return json(200, { status: 'ok' });
      const user = auth.getUser(req.headers.cookie);
      if (pathname.startsWith('/api/')) {
        if (req.method !== 'GET') {
          const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
          const expected = publicUrl ? new URL(publicUrl).origin : `${secure ? 'https' : 'http'}://${req.headers.host}`;
          if (req.headers.origin !== expected) return json(403, { error: '허용되지 않은 요청 출처입니다.' });
          if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON 요청만 지원합니다.' });
        }
        if ((pathname === '/api/me' && req.method === 'GET' || pathname === '/api/login' && req.method === 'POST') && !auth.users().length) {
          return json(503, { code: 'SETUP_REQUIRED', error: '아직 관리자 계정이 등록되지 않아 로그인할 수 없습니다. 서비스 관리자에게 초기 계정 설정을 요청해 주세요.' });
        }
        if (pathname === '/api/login' && req.method === 'POST') {
          const ip = req.socket.remoteAddress;
          if (limited(ipAttempts, ip, 100)) return json(429, { error: '로그인 요청이 많습니다. 15분 후 다시 시도하세요.' });
          const input = await body(req);
          if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 128 || input.username.length > 40) return json(400, { error: '아이디와 비밀번호를 확인하세요.' });
          const key = `${ip}:${input.username}`;
          if (limited(attempts, key, 10)) return json(429, { error: '로그인 시도가 많습니다. 15분 후 다시 시도하세요.' });
          const session = await auth.login(input.username, input.password);
          if (!session) return json(401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
          attempts.delete(key);
          res.setHeader('Set-Cookie', session.cookie);
          return json(200, { user: publicUser(session.user) });
        }
        if (!user) return json(401, { error: '직원 로그인이 필요합니다.' });
        if (pathname === '/api/me' && req.method === 'GET') return json(200, { user: publicUser(user) });
        if (pathname === '/api/logout' && req.method === 'POST') {
          res.setHeader('Set-Cookie', auth.logout(user));
          return json(200, { ok: true });
        }
        if (pathname === '/api/prices' && req.method === 'GET') return json(200, { sources: collector.state(), refreshing: collector.running, intervalMinutes: collector.intervalMs / 60_000, serverTime: new Date().toISOString() });
        if (user.role !== 'admin') return json(403, { error: '관리자만 사용할 수 있습니다.' });
        if (pathname === '/api/refresh' && req.method === 'POST') {
          collector.refresh().catch(error => console.error('Collection failed:', error.message));
          return json(collector.running ? 202 : 200, { refreshing: collector.running });
        }
        if (pathname === '/api/sources' && req.method === 'POST') {
          const input = await body(req);
          collector.setUrl(input.id, input.url);
          return json(200, { ok: true });
        }
        if (pathname === '/api/users' && req.method === 'GET') return json(200, { users: auth.users().map(publicUser) });
        if (pathname === '/api/users' && req.method === 'POST') {
          const input = await body(req);
          const added = await auth.addUser(input.username, input.name, input.password);
          return json(201, { user: publicUser(added) });
        }
        if (pathname === '/api/users/disable' && req.method === 'POST') {
          const input = await body(req);
          auth.disable(input.username);
          return json(200, { ok: true });
        }
        if (pathname === '/api/users/reset' && req.method === 'POST') {
          const input = await body(req);
          await auth.resetPassword(input.username, input.password);
          return json(200, { ok: true });
        }
        return json(404, { error: '요청한 기능을 찾을 수 없습니다.' });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'] };
      if (req.method !== 'GET' || !files[pathname]) return json(404, { error: '페이지를 찾을 수 없습니다.' });
      const [file, mime] = files[pathname];
      const content = await readFile(resolve(publicDirectory, file));
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
      res.end(content);
    } catch (error) {
      if (error.code) { console.error('Request failed:', error.code); return json(500, { error: '서버 처리 중 오류가 발생했습니다.' }); }
      return json(error.status || 400, { error: error.message || '요청을 처리할 수 없습니다.' });
    }
  });
  return { server, auth, collector, store };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Price board listening on port ${port}`);
    if (!app.auth.users().length) console.log('관리자 미등록: ADMIN_USERNAME과 ADMIN_PASSWORD(12자 이상)를 설정하고 재시작하세요.');
    app.collector.refresh().catch(error => console.error('Collection failed:', error.message));
  });
  const timer = setInterval(() => app.collector.refresh().catch(error => console.error('Collection failed:', error.message)), app.collector.intervalMs);
  const stop = () => { clearInterval(timer); app.server.close(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
