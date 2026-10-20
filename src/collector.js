import robotsParser from 'robots-parser';
import { SOURCES, fetchPage, parsePrices, validateUrl } from './prices.js';
import { fetchEkcmPrices } from './ekcm.js';

function networkErrorCodes(error) {
  const codes = new Set();
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value.code)) codes.add(value.code);
    visit(value.cause);
    if (Array.isArray(value.errors)) value.errors.forEach(visit);
  }
  visit(error);
  return [...codes];
}

export function createCollector(store, options = {}) {
  let running = null;
  let lastAttempt = 0;
  const fetcher = options.fetcher || fetch;
  const intervalMs = 30 * 60 * 1000;
  const settings = () => store.read('sources', {});
  const pageUrl = source => settings()[source.id] || process.env[source.env] || source.home;
  const state = () => {
    const saved = store.read('prices', {});
    return SOURCES.map(source => ({ id: source.id, name: source.name, home: source.home, pageUrl: pageUrl(source), status: 'pending', items: [], lastSuccess: null, lastAttempt: null, message: '아직 원본 가격을 확인하지 못했습니다.', ...saved[source.id] }));
  };
  async function collect(source) {
    const attemptedAt = new Date().toISOString();
    try {
      const url = validateUrl(pageUrl(source), source);
      const robotsUrl = new URL('/robots.txt', url).href;
      let robotsText = '';
      try { robotsText = (await fetchPage(robotsUrl, source, fetcher)).html; }
      catch (error) { if (!error.message.includes('HTTP 404')) throw error; }
      if (robotsParser(robotsUrl, robotsText).isAllowed(url, 'DaeguPriceBoard') === false) throw new Error('사이트의 robots.txt에서 자동 수집을 허용하지 않습니다.');
      const page = await fetchPage(url, source, fetcher);
      let items = parsePrices(page.html, source, page.url);
      if (!items.length && source.id === 'ekcm' && page.html.includes('gw.ekcm.co.kr')) items = await fetchEkcmPrices(source, fetcher);
      if (!items.length) throw new Error(source.id === 'ekcm' && page.html.includes('gw.ekcm.co.kr') ? '금천미트 가격은 별도 API(gw.ekcm.co.kr)에서 불러옵니다. API 연결 및 공개 가격 확인이 필요합니다.' : '이 페이지에서 공개 가격표를 찾지 못했습니다. 가격 페이지 주소 또는 사이트별 수집 방식 확인이 필요합니다.');
      const saved = store.read('prices', {});
      saved[source.id] = { status: 'ok', items, lastSuccess: attemptedAt, lastAttempt: attemptedAt, errorCodes: [], message: `${items.length}개 가격을 확인했습니다.` };
      store.write('prices', saved);
    } catch (error) {
      const saved = store.read('prices', {});
      const message = error.message === 'fetch failed' ? '원본 사이트에 연결할 수 없습니다. 네트워크 허용 설정과 사이트 접근 상태를 확인하세요.' : error.name === 'TimeoutError' ? '원본 사이트 응답 시간이 초과되었습니다.' : error.message;
      saved[source.id] = { ...saved[source.id], status: 'error', lastAttempt: attemptedAt, errorCodes: networkErrorCodes(error), message };
      store.write('prices', saved);
    }
  }
  return {
    state,
    get running() { return Boolean(running); },
    intervalMs,
    setUrl(id, url) {
      if (running) throw new Error('수집 완료 후 주소를 변경하세요.');
      const source = SOURCES.find(s => s.id === id);
      if (!source) throw new Error('등록되지 않은 사이트입니다.');
      store.write('sources', { ...settings(), [id]: validateUrl(url, source) });
      const saved = store.read('prices', {});
      delete saved[id];
      store.write('prices', saved);
    },
    refresh({ force = false } = {}) {
      if (running) return running;
      if (!force && Date.now() - lastAttempt < 60_000) return Promise.resolve(false);
      lastAttempt = Date.now();
      running = Promise.all(SOURCES.map(collect)).then(() => true).finally(() => { running = null; });
      return running;
    },
  };
}
