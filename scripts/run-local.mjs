import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const app = await createApp({ secure: false, dataDir: './data' });
if (!app.auth.users().length) {
  const password = randomBytes(15).toString('base64url');
  await app.auth.addUser('admin', '관리자', password, 'admin');
  console.log(`\n첫 로그인 아이디: admin\n첫 로그인 비밀번호: ${password}\n비밀번호를 안전한 곳에 보관하세요. 이 창에서 한 번만 표시합니다.\n`);
}
app.server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? '3000번 포트가 사용 중입니다. 이전 앱 실행 창을 닫은 뒤 다시 실행하세요.' : `앱 실행 실패: ${error.message}`);
  process.exitCode = 1;
});
app.server.listen(3000, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:3000';
  console.log(`실제 가격 조회 앱: ${url}\n종료하려면 이 창에서 Ctrl+C를 누르세요.\n원본 사이트 가격을 수집하고 있습니다.`);
  const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const browser = spawn(command[0], command[1], { stdio: 'ignore' });
  browser.on('error', () => {});
  browser.unref();
  const refresh = async () => {
    await app.collector.refresh();
    for (const source of app.collector.state()) console.log(`${source.name}: ${source.status}, ${source.items.length}건 — ${source.message}`);
  };
  refresh().catch(error => console.error(error.message));
  const timer = setInterval(() => refresh().catch(error => console.error(error.message)), app.collector.intervalMs);
  const stop = () => { clearInterval(timer); app.server.close(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
