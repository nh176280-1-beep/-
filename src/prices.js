import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export const SOURCES = [
  { id: 'ekcm', name: '금천미트', host: 'ekcm.co.kr', home: 'https://www.ekcm.co.kr/', env: 'EKCM_PRICE_URL' },
  { id: 'ilpoom', name: '일품한우', host: 'ilpoomhanwoo.com', home: 'https://www.ilpoomhanwoo.com/', env: 'ILPOOM_PRICE_URL' },
];
export function validateUrl(value, source) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || ![source.host, `www.${source.host}`].includes(url.hostname) || url.port || url.username || url.password) {
    throw new Error('해당 사이트의 HTTPS 가격 페이지 주소만 사용할 수 있습니다.');
  }
  url.hash = '';
  return url.href;
}
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
function priceNumber(value) {
  const text = clean(value).replace(/,/g, '').replace(/^(?:₩|KRW)\s*/i, '').replace(/\s*(?:원|KRW)$/i, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return number > 0 && Number.isSafeInteger(Math.round(number * 100)) ? number : null;
}
export function parsePrices(html, source, pageUrl) {
  const $ = load(html);
  const items = [];
  function add(row) {
    if (!row.name || row.price === null) return;
    const item = { ...row, sourceId: source.id, sourceName: source.name, url: validateUrl(row.url || pageUrl, source) };
    item.id = createHash('sha256').update(JSON.stringify([source.id, item.url, item.name, item.grade, item.unit])).digest('hex').slice(0, 20);
    items.push(item);
  }
  // Verified against ilpoomhanwoo.com public product cards. Unit price and lot total are distinct.
  if (source.id === 'ilpoom') {
    $('li.gl_item').each((_, element) => {
      const card = $(element);
      const link = card.find('.displaY_goods_name a[href]').first();
      const name = clean(link.text());
      const priceBlocks = card.find('.displaY_sales_price').toArray();
      const unitBlock = priceBlocks.find(block => /kg당/.test($(block).text()));
      if (!unitBlock || !name) return;
      const unitText = clean($(unitBlock).text());
      const match = unitText.match(/kg당\s*([\d,]+)\s*원\s*\/\s*([\d.]+)\s*kg/);
      if (!match) return;
      const totalBlock = priceBlocks.find(block => block !== unitBlock && $(block).find('.nuM').length);
      const totalPrice = totalBlock ? priceNumber($(totalBlock).find('.nuM').first().text()) : null;
      let itemUrl;
      try { itemUrl = validateUrl(new URL(link.attr('href'), pageUrl).href, source); } catch { return; }
      add({ name, price: priceNumber(match[1]), unit: '1kg', grade: name.match(/\/(1\+\+(?:\(\d+\))?|1\+|[123])\[/)?.[1] || '', lotWeight: `${match[2]}kg`, totalPrice, url: itemUrl,
        availability: /품절/.test(card.find('.goods_soldout, .soldout, .soldout_layer').text()) ? '품절' : '', method: '일품한우 공개 상품 카드' });
    });
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const types = [].concat(node['@type'] || []);
    if (types.includes('Product') && node.name) {
      for (const offer of [].concat(node.offers || [])) {
        // AggregateOffer lowPrice is not an exact purchasable price.
        if (!offer || offer.priceCurrency !== 'KRW') continue;
        const price = priceNumber(offer.price);
        const spec = offer.priceSpecification;
        const reference = spec?.referenceQuantity;
        const unit = reference?.unitText ? `${reference.value || 1}${reference.unitText}` : '단위 미표기';
        add({ name: clean(node.name), price, grade: '', unit, availability: /OutOfStock|SoldOut/.test(offer.availability || '') ? '품절' : '', method: '구조화된 상품 가격' });
      }
    }
    Object.values(node).forEach(walk);
  }
  $('script[type="application/ld+json"]').each((_, script) => {
    try { walk(JSON.parse($(script).text())); } catch { /* Invalid optional metadata is ignored. */ }
  });
  $('table').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    let headerIndex = -1, headers = [];
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const cells = $(rows[i]).children('th,td').toArray().map(cell => clean($(cell).text()));
      if (cells.some(c => /품목|상품명|제품명|부위/.test(c)) && cells.some(c => /판매가|판매가격|단가|가격/.test(c))) { headerIndex = i; headers = cells; break; }
    }
    if (headerIndex < 0) return;
    const nameIndex = headers.findIndex(c => /품목|상품명|제품명|부위/.test(c));
    const priceIndexes = headers.map((c, i) => /판매가|판매가격|단가|가격/.test(c) ? i : -1).filter(i => i >= 0);
    // Multiple price columns may refer to different grades or customer tiers: require a site adapter.
    if (priceIndexes.length !== 1) return;
    const priceIndex = priceIndexes[0];
    const unitIndex = headers.findIndex(c => /단위|규격|중량/.test(c));
    const gradeIndex = headers.findIndex(c => /등급/.test(c));
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = $(row).children('td,th').toArray();
      if (cells.length !== headers.length || cells.some(cell => Number($(cell).attr('colspan') || 1) > 1 || Number($(cell).attr('rowspan') || 1) > 1)) continue;
      const values = cells.map(cell => clean($(cell).text()));
      if (!/[원₩]|KRW/i.test(values[priceIndex] + headers[priceIndex] + $(table).find('caption').text())) continue;
      const unitInHeader = headers[priceIndex].match(/(?:원\s*\/\s*|\/\s*)(\d*\s*(?:kg|g|100g|두|팩))/i)?.[1];
      add({ name: values[nameIndex], price: priceNumber(values[priceIndex]), grade: gradeIndex >= 0 ? values[gradeIndex] : '', unit: unitIndex >= 0 ? values[unitIndex] : unitInHeader || '단위 미표기', availability: '', method: '가격표' });
    }
  });
  return [...new Map(items.map(item => [item.id, item])).values()];
}

export async function fetchPage(url, source, fetcher = fetch, { accept = 'text/html,text/plain;q=0.9' } = {}) {
  let current = validateUrl(url, source);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(current, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'DaeguPriceBoard/1.0', Accept: accept } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      current = validateUrl(new URL(response.headers.get('location'), current).href, source);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`원본 서버 응답: HTTP ${response.status}`); }
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2_000_000) throw new Error('페이지 크기가 수집 제한을 초과했습니다.');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
      || buffer.toString('ascii', 0, 4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
    return { html: new TextDecoder(charset).decode(buffer), url: current };
  }
  throw new Error('리디렉션 횟수가 너무 많습니다.');
}
