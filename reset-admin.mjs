import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

export function resetAdmin(directory) {
  const file = join(directory, 'users.json');
  let original;
  try { original = readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('기존 계정 파일이 없습니다. 재설정 파일을 start.cmd와 같은 폴더에 넣으세요.');
    throw error;
  }
  const users = JSON.parse(original);
  if (!Array.isArray(users)) throw new Error('계정 파일 형식이 올바르지 않습니다.');
  const admin = users.find(user => user.username === 'admin' && user.role === 'admin') || users.find(user => user.role === 'admin');
  if (!admin) throw new Error('관리자 계정을 찾을 수 없습니다. 기존 data 폴더가 있는지 확인하세요.');
  const password = randomBytes(15).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  const updated = users.map(user => user === admin ? { ...user, hash, disabled: false, version: (user.version || 1) + 1 } : user);
  const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(updated, null, 2), { mode: 0o600, flag: 'wx' });
    if (readFileSync(file, 'utf8') !== original) throw new Error('계정 정보가 변경되었습니다. 앱을 종료하고 다시 실행하세요.');
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { username: admin.username, password };
}

async function ensureAppStopped() {
  await new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3000 });
    socket.once('connect', () => { socket.destroy(); reject(new Error('앱이 실행 중입니다. 기존 start.cmd 실행 창을 먼저 닫고 다시 실행하세요.')); });
    socket.once('error', error => {
      if (error.code === 'ECONNREFUSED') resolvePromise();
      else reject(new Error(`앱 종료 여부를 확인할 수 없습니다: ${error.code}`));
    });
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('앱 종료 여부 확인 시간이 초과되었습니다.')); });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await ensureAppStopped();
    const result = resetAdmin(fileURLToPath(new URL('./data/', import.meta.url)));
    console.log(`\n관리자 비밀번호 재설정 완료\n\n아이디: ${result.username}\n새 비밀번호: ${result.password}\n\n새 비밀번호를 보관한 뒤 start.cmd를 실행하고 로그인하세요.\n직원 계정과 가격 데이터는 유지됩니다.\n`);
  } catch (error) {
    console.error(`\n재설정 실패: ${error.message}\n`);
    process.exitCode = 1;
  }
}
