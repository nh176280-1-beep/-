import robotsParser from 'robots-parser';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { fetchPage, validateUrl } from './prices.js';

const apiSource = { host: 'gw.ekcm.co.kr' };
const endpoint = 'https://gw.ekcm.co.kr/api/goods/v1/search/product';
const positive = value => /^(?:\d+)(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function parseEkcmPrices(data, source) {
  if (data.error || data.code !== '0000' || !Array.isArray(data.payload?.searchDataList)) throw new Error('금천미트 공개 검색 API 응답을 확인할 수 없습니다.');
  const items = [];
  for (const row of data.payload.searchDataList) {
    if (row.dispLoginYn !== 'N' || !/^\d+$/.test(String(row.goodsNo)) || !row.goodsNm) continue;
    let extra;
    try { extra = JSON.parse(row.extraData); } catch { continue; }
    if (!extra || extra.SALE_STAT_CD !== '10') continue;
    const byWeight = extra.SALE_UNIT_GB_CD === '4';
    const price = positive(byWeight ? extra.REAL_UCOST : row.salePrc);
    const totalPrice = positive(row.salePrc);
    const weight = positive(extra.USE_ENAB_WGT);
    if (!price || !totalPrice || (byWeight && !weight)) continue;
    // The public app displays REAL_UCOST per kg, independently of SALE_PRC.
    const url = validateUrl(`https://www.ekcm.co.kr/pd/productDetail?goodsNo=${row.goodsNo}`, source);
    const grade = String(extra.LSPRD_GRD_NM || '');
    const name = String(row.goodsNm).replace(/\s+/g, ' ').trim();
    const unit = byWeight ? '1kg' : String(extra.SALE_UNIT_GB_NM || '단위 미표기');
    const id = createHash('sha256').update(JSON.stringify([source.id, url, name, grade, unit])).digest('hex').slice(0, 20);
    items.push({ id, sourceId: source.id, sourceName: source.name, name, price, totalPrice, unit, grade, lotWeight: weight ? `${weight}kg` : '', url, availability: Number(extra.STK_QTY) > 0 ? '' : '품절', method: '금천미트 공개 전체 상품 API' });
  }
  return [...new Map(items.map(item => [item.id, item])).values()];
}

export async function fetchEkcmPrices(source, fetcher, options = {}) {
  const robotsUrl = 'https://gw.ekcm.co.kr/robots.txt';
  let robotsText = '';
  try { robotsText = (await fetchPage(robotsUrl, apiSource, fetcher)).html; }
  catch (error) { if (!error.message.includes('HTTP 404')) throw error; }
  const robots = robotsParser(robotsUrl, robotsText);
  const rows = new Map();
  const size = 250;
  let pages = 0, expected = 0;
  async function request(filters, from = 0, sort = 'desc', count = size) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ searchWord: '', langCd: 'ko', page: String(Math.floor(from / count) + 1), aplyPsbMediaCd: '01', filters, sort, sortField: 'goodsNo.keyword', from: String(from), size: String(count) });
    if (robots.isAllowed(url.href, 'DaeguPriceBoard') === false) throw new Error('금천미트 API의 robots.txt에서 자동 수집을 허용하지 않습니다.');
    if (pages) await delay(options.delayMs ?? 200);
    let page;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { page = await fetchPage(url.href, apiSource, fetcher, { accept: 'application/json' }); break; }
      catch (error) {
        if (attempt === 2 || !(/HTTP (429|5\d\d)/.test(error.message) || error.name === 'TimeoutError' || error.message === 'fetch failed')) throw error;
        await delay(1000 * 2 ** attempt);
      }
    }
    const data = JSON.parse(page.html);
    parseEkcmPrices(data, source); // Validate the envelope before accepting any page.
    const total = Number(data.payload.totalCount);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('금천미트 API의 전체 상품 수가 올바르지 않습니다.');
    pages++;
    return data.payload;
  }
  function accept(payload, local) {
    for (const row of payload.searchDataList) {
      if (!/^\d+$/.test(String(row.goodsNo))) throw new Error('금천미트 API 상품번호 누락으로 전체 목록을 검증할 수 없습니다.');
      local.add(String(row.goodsNo));
      rows.set(String(row.goodsNo), row);
    }
    options.onProgress?.({ scanned: rows.size, sourceTotal: expected, pages });
  }
  async function scan(filters, first, depth = 0) {
    const total = Number(first.totalCount);
    if (total > 20000) {
      const groups = first.brandNoCnt?.flatMap(entry => Object.entries(entry)) || [];
      if (depth || !groups.length || groups.reduce((n, [, count]) => n + Number(count), 0) !== total) throw new Error('금천미트 API 검색 상한 내에서 전체 목록을 분할할 수 없습니다. 일부 수집으로 완료 처리하지 않습니다.');
      for (const [brand] of groups) {
        const next = [filters, `brandNo:${brand}`].filter(Boolean).join(',');
        await scan(next, await request(next), depth + 1);
      }
      return;
    }
    const local = new Set();
    accept(first, local);
    for (const sort of ['desc', 'asc']) {
      const start = sort === 'desc' ? first.searchDataList.length : 0;
      for (let from = start; from < Math.min(total, 10000) && local.size < total; from += size) {
        const result = await request(filters, from, sort);
        if (!result.searchDataList.length) throw new Error('금천미트 전체 목록 수집 중 빈 페이지가 반환되었습니다.');
        accept(result, local);
      }
      if (local.size >= total) break;
    }
    if (local.size < total) throw new Error(`금천미트 전체 목록 검증 실패: ${total}개 중 ${local.size}개 확인. 기존 정상 데이터를 유지합니다.`);
  }
  const root = await request('');
  expected = Number(root.totalCount);
  if (expected <= 10000) await scan('', root);
  else {
    const categories = root.lrgCtgGrpNoCnt?.flatMap(entry => Object.entries(entry)) || [];
    if (!categories.length) throw new Error('금천미트 전체 조회에 필요한 카테고리 정보가 없습니다.');
    for (const [category] of categories) {
      const filters = `lrgCtgNo:${category}`;
      await scan(filters, await request(filters));
    }
  }
  const sourceTotalAtStart = expected;
  // Live stock can change during a multi-minute scan. Recheck the latest head
  // and total rather than treating a sale during collection as a missing page.
  const final = await request('');
  expected = Number(final.totalCount);
  accept(final, new Set());
  if (rows.size < Math.min(sourceTotalAtStart, expected)) throw new Error(`금천미트 전체 목록 검증 실패: 시작 ${sourceTotalAtStart}개, 종료 ${expected}개, 조회 ${rows.size}개.`);
  const items = parseEkcmPrices({ code: '0000', payload: { searchDataList: [...rows.values()] } }, source);
  options.onComplete?.({ complete: true, sourceTotal: expected, sourceTotalAtStart, changedDuringCollection: sourceTotalAtStart !== expected, scanned: rows.size, priceCount: items.length, excludedCount: rows.size - items.length, pages });
  return items;
}
