import {createHash} from 'node:crypto';
import {validateUrl} from './prices.js';
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

