import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { load } from 'cheerio';

const root = fileURLToPath(new URL('../', import.meta.url));
const [html, css, app, icon] = await Promise.all(['public/index.html', 'public/style.css', 'public/app.js', 'public/icon.svg'].map(path => readFile(resolve(root, path), 'utf8')));
const $ = load(html);

// This artifact never reads data/, credentials, or source prices. It is a separate offline demo.
const sampleProducts = [
  ['등심', '1++', 68000], ['안심', '1+', 79000], ['채끝', '1++', 72000], ['부채살', '1+', 51000],
  ['등심', '1+', 63000], ['안심', '1++', 83000], ['사태', '1', 26000], ['양지', '1+', 34000],
];
const sources = [
  { id: 'ekcm', name: '금천미트', home: 'https://www.ekcm.co.kr/' },
  { id: 'ilpoom', name: '일품한우', home: 'https://www.ilpoomhanwoo.com/' },
].map((source, sourceIndex) => ({
  ...source, pageUrl: source.home, status: 'ok', lastSuccess: '2000-01-01T00:00:00Z',
  items: sampleProducts.slice(sourceIndex * 4, sourceIndex * 4 + 4).map(([name, grade, price], index) => ({
    id: `preview-${source.id}-${index}`, name, grade, price, unit: '1kg', lotWeight: '2.00kg', totalPrice: price * 2,
    sourceId: source.id, sourceName: `${source.name} · 예시`, url: source.home, availability: '',
  })),
}));
const transport = `async function api(path) {
  if (path === '/api/me') return { user: { username: 'offline-preview-only', name: '체험 사용자', role: 'staff' } };
  if (path === '/api/prices') return { sources: ${JSON.stringify(sources)}, refreshing: false };
  throw new Error('체험 화면에서는 실제 계정이나 서버 정보를 변경할 수 없습니다.');
}
`;
function replaceFunction(source, name, nextName, replacement) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert(start >= 0 && end > start, `Cannot locate ${name}; update preview builder`);
  return source.slice(0, start) + replacement + source.slice(end);
}
let script = replaceFunction(app, 'api', 'formatTime', transport);
script = script.replace(/function isStale\(source\) \{[^\n]*\}/, 'function isStale() { return false; }')
  .replaceAll("'확인 완료'", "'예시 데이터'")
  .replaceAll('${formatTime(source.lastSuccess)} 확인 ·', '체험용 ·')
  .replaceAll('${formatTime(item.lastSuccess)} 확인', '실제 판매가 아님')
  .replaceAll('원본 확인 ↗', '사이트 방문 ↗')
  .replaceAll('오늘의 가격, 한눈에', '가격 조회 체험')
  .replaceAll('두 사이트의 가격 정보를 한곳에서 확인하세요.', '검색과 관심 품목을 직접 눌러보세요. 모든 가격은 예시입니다.')
  .replaceAll('최신 저장 정보를 조회했습니다.', '체험용 예시 목록을 다시 표시했습니다.')
  .replace("window.addEventListener('offline', () => { if (state.user) { state.requestFailed = true; renderPrices(); } });", '');

$('title').text('한눈에 시세 · 오프라인 화면 체험');
$('link[rel="stylesheet"], link[rel="manifest"], script[src]').remove();
$('head').append('<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; script-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">');
const imageUrl = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;
$('link[rel="icon"]').attr('href', imageUrl);
$('img[src="/icon.svg"]').attr('src', imageUrl);
$('a[href="/"]').attr('href', '#');
$('#logout').attr('hidden', '');
$('.overview-stats > div').last().html('<span>로그인·설치</span><strong>불필요</strong>');
$('.price-disclaimer').text('이 파일은 화면 체험용입니다. 표시된 모든 상품·등급·금액은 가상의 예시이며 실제 판매 가격이나 수집 결과가 아닙니다. 실제 직원 서비스는 계정 등록과 서버 배포가 필요합니다.');
$('#page-title').text('가격 조회 체험');
$('.topbar').before('<aside class="preview-banner" role="note"><strong>화면 체험용 · 예시 가격</strong><span>실제 판매가가 아닙니다. 로그인 없이 검색·별표 저장을 눌러보세요.</span></aside>');
const previewCss = `
.preview-banner{display:flex;justify-content:center;align-items:center;gap:16px;padding:13px 20px;background:#fff0cb;color:#76521d;font-size:12px;line-height:1.6;border-bottom:1px solid #ebd8a8}
.overview-stats>div:last-child strong{font-size:24px;letter-spacing:-1px}
.workspace{min-height:calc(100dvh - 138px)}
@media(max-width:760px){.preview-banner{display:block;padding:12px 20px;font-size:11px}.preview-banner strong,.preview-banner span{display:block}.page-heading .muted{max-width:210px}.overview-stats>div:last-child strong{font-size:19px}.account{gap:0}.content{padding-top:20px}.source-card .status-pill{font-size:9px}}
`;
$('head').append($('<style>').text(css + previewCss));
$('body').append($('<script type="module">').text(script.replaceAll('</script', '<\\/script')));
await mkdir(resolve(root, 'preview'), { recursive: true });
await writeFile(resolve(root, 'preview/index.html'), $.html().replace(/[\t ]+$/gm, ''));
console.log('Created preview/index.html — self-contained offline demo; no real prices or credentials.');
