import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const MAX_AGE = 8 * 60 * 60;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  const actual = await scrypt(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}
export function createAuth(store, secure = false) {
  const users = () => store.read('users', []);
  const signature = data => createHmac('sha256', store.key).update(data).digest('base64url');
  const cookie = token => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? MAX_AGE : 0}${secure ? '; Secure' : ''}`;
  return {
    users,
    async addUser(username, name, password, role = 'staff') {
      if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('아이디는 영문·숫자·._- 조합으로 3~40자여야 합니다.');
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('비밀번호는 12~128자로 입력하세요.');
      const hash = await hashPassword(password);
      const existing = users();
      if (existing.some(user => user.username === username)) throw new Error('이미 사용 중인 아이디입니다.');
      const user = { username, name: String(name || username).slice(0, 40), hash, role, version: 1 };
      store.write('users', [...existing, user]);
      return user;
    },
    async login(username, password) {
      const user = users().find(user => user.username === username && !user.disabled);
      // Unknown users also run scrypt to reduce account enumeration through timing.
      const valid = await verifyPassword(password, user?.hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
      if (!user || !valid) return null;
      const payload = Buffer.from(JSON.stringify({ u: user.username, v: user.version, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
      return { user, cookie: cookie(`${payload}.${signature(payload)}`) };
    },
    getUser(header = '') {
      const token = header.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
      if (!token || token.length > 1000) return null;
      const [payload, supplied] = token.split('.');
      if (!payload || !supplied) return null;
      const expected = signature(payload);
      if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
      try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (session.exp <= Date.now() / 1000) return null;
        return users().find(user => user.username === session.u && user.version === session.v && !user.disabled) || null;
      } catch { return null; }
    },
    logout(user) {
      store.write('users', users().map(u => u.username === user.username ? { ...u, version: u.version + 1 } : u));
      return cookie('');
    },
    disable(username) {
      store.write('users', users().map(u => u.username === username && u.role !== 'admin' ? { ...u, disabled: true, version: u.version + 1 } : u));
    },
    async resetPassword(username, password) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('비밀번호는 12~128자로 입력하세요.');
      const hash = await hashPassword(password);
      const existing = users();
      const user = existing.find(u => u.username === username);
      if (!user) throw new Error('직원 아이디를 확인하세요.');
      if (user.role === 'admin') throw new Error('이 화면에서는 직원 계정만 재설정할 수 있습니다.');
      store.write('users', existing.map(u => u.username === username ? { ...u, hash, disabled: false, version: u.version + 1 } : u));
    },
  };
}
