import robotsParser from 'robots-parser';
import { createHash } from 'node:crypto';
import { fetchPage, validateUrl } from './prices.js';

const apiSource = { host: 'gw.ekcm.co.kr' };
const searchUrl = 'https://gw.ekcm.co.kr/api/goods/v1/search/product?searchWord=%ED%95%9C%EC%9A%B0&langCd=ko&page=1&aplyPsbMediaCd=01&filters=&sort=desc&sortField=customData9&from=0';
const positive = value => /^(?:\d+)(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function parseEkcmPrices(data, source) {
  if (data.error || data.code !== '0000' || !Array.isArray(data.payload?.searchDataList)) throw new Error('금천미트 공개 검색 API 응답을 확인할 수 없습니다.');
  const items = [];
  for (const row of data.payload.searchDataList) {
    if (row.dispLoginYn !== 'N' || !/^\d+$/.test(String(row.goodsNo)) || !row.goodsNm) continue;
    let extra;
    try { extra = JSON.parse(row.extraData); } catch { continue; }
    if (!extra || extra.SALE_UNIT_GB_CD !== '4' || extra.SALE_STAT_CD !== '10') continue;
    const price = positive(extra.REAL_UCOST);
    const totalPrice = positive(row.salePrc);
    const weight = positive(extra.USE_ENAB_WGT);
    if (!price || !totalPrice || !weight) continue;
    // The public app displays REAL_UCOST per kg, independently of SALE_PRC.
    const url = validateUrl(`https://www.ekcm.co.kr/pd/productDetail?goodsNo=${row.goodsNo}`, source);
    const grade = String(extra.LSPRD_GRD_NM || '');
    const name = String(row.goodsNm).replace(/\s+/g, ' ').trim();
    const unit = '1kg';
    const id = createHash('sha256').update(JSON.stringify([source.id, url, name, grade, unit])).digest('hex').slice(0, 20);
    items.push({ id, sourceId: source.id, sourceName: source.name, name, price, totalPrice, unit, grade, lotWeight: `${weight}kg`, url, availability: Number(extra.STK_QTY) > 0 ? '' : '품절', method: '금천미트 공개 한우 검색 API (첫 페이지)' });
  }
  return [...new Map(items.map(item => [item.id, item])).values()];
}

export async function fetchEkcmPrices(source, fetcher) {
  const robotsUrl = 'https://gw.ekcm.co.kr/robots.txt';
  let robotsText = '';
  try { robotsText = (await fetchPage(robotsUrl, apiSource, fetcher)).html; }
  catch (error) { if (!error.message.includes('HTTP 404')) throw error; }
  if (robotsParser(robotsUrl, robotsText).isAllowed(searchUrl, 'DaeguPriceBoard') === false) throw new Error('금천미트 API의 robots.txt에서 자동 수집을 허용하지 않습니다.');
  const page = await fetchPage(searchUrl, apiSource, fetcher, { accept: 'application/json' });
  return parseEkcmPrices(JSON.parse(page.html), source);
}
