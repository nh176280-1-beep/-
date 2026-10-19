import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrices, SOURCES, validateUrl, fetchPage } from '../src/prices.js';

const source = SOURCES[0];
const url = source.home;
const product = { '@type': 'Product', name: '테스트 등심', offers: { '@type': 'Offer', price: '12500', priceCurrency: 'KRW' } };
const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
test('extracts exact KRW offer without assuming a weight unit', () => {
  const items = parsePrices(html({ '@graph': [product] }), source, url);
  assert.equal(items.length, 1); assert.equal(items[0].price, 12500); assert.equal(items[0].unit, '단위 미표기'); assert.equal(items[0].url, url);
});
test('does not convert aggregate, missing-currency, inquiry or foreign-currency prices', () => {
  for (const offers of [{ lowPrice: 1000, priceCurrency: 'KRW' }, { price: 1000 }, { price: '별도 문의', priceCurrency: 'KRW' }, { price: 10, priceCurrency: 'USD' }]) {
    assert.equal(parsePrices(html({ ...product, offers }), source, url).length, 0);
  }
});
test('reads units and grades from explicit table columns', () => {
  const table = '<table><tr><th>부위</th><th>등급</th><th>규격</th><th>판매가(원)</th></tr><tr><td>등심</td><td>1++</td><td>100g</td><td>12,500</td></tr></table>';
  const [item] = parsePrices(table, source, url);
  assert.equal(item.price, 12500); assert.equal(item.unit, '100g'); assert.equal(item.grade, '1++');
});
test('rejects ambiguous multiple price columns and price ranges', () => {
  const table = '<table><tr><th>부위</th><th>도매 가격(원)</th><th>소매 가격(원)</th></tr><tr><td>등심</td><td>1000</td><td>2000</td></tr></table>';
  assert.deepEqual(parsePrices(table, source, url), []);
  assert.deepEqual(parsePrices(html({ ...product, offers: { price: '1000~2000', priceCurrency: 'KRW' } }), source, url), []);
});
test('rejects SSRF URLs, credentials, insecure schemes and ports', () => {
  for (const value of ['http://www.ekcm.co.kr/', 'https://127.0.0.1/', 'https://www.ekcm.co.kr.evil.example/', 'https://u:p@www.ekcm.co.kr/', 'https://www.ekcm.co.kr:444/']) assert.throws(() => validateUrl(value, source));
  assert.equal(validateUrl('https://www.ekcm.co.kr/shop?id=1', source), 'https://www.ekcm.co.kr/shop?id=1');
});
test('blocks redirects outside the approved source', async () => {
  await assert.rejects(fetchPage(url, source, async () => new Response('', { status: 302, headers: { location: 'https://127.0.0.1/' } })), /HTTPS/);
});
test('ignores invalid JSON-LD and zero prices', () => {
  assert.deepEqual(parsePrices('<script type="application/ld+json">broken</script>', source, url), []);
  assert.deepEqual(parsePrices(html({ ...product, offers: { price: 0, priceCurrency: 'KRW' } }), source, url), []);
});
test('ilpoom adapter keeps kg unit price separate from lot total and retains distinct lots', () => {
  // Minimal markup matching the public ilpoom cards inspected during integration.
  const card = id => `<li class="gl_item"><div class="displaY_goods_name"><a href="/goods/view?no=${id}">한우채끝/거세/2[냉장]</a></div><div class="displaY_sales_price">kg당 <span class="nuM">63,053</span>원 / 3.70kg</div><div class="displaY_sales_price"><span class="nuM">233,290</span>원</div></li>`;
  const result = parsePrices(`<ul>${card('4092680')}${card('4092681')}</ul>`, SOURCES[1], SOURCES[1].home);
  assert.equal(result.length, 2);
  assert.equal(result[0].price, 63053); assert.equal(result[0].unit, '1kg'); assert.equal(result[0].totalPrice, 233290);
  assert.equal(result[0].lotWeight, '3.70kg'); assert.equal(result[0].grade, '2');
  assert.equal(result[0].url, 'https://www.ilpoomhanwoo.com/goods/view?no=4092680');
  assert.notEqual(result[0].id, result[1].id);
});
test('ilpoom adapter does not interpret a total-only card as a kg price', () => {
  const html = '<li class="gl_item"><div class="displaY_goods_name"><a href="/goods/view?no=1">등심</a></div><div class="displaY_sales_price"><span class="nuM">12345</span>원</div></li>';
  assert.deepEqual(parsePrices(html, SOURCES[1], SOURCES[1].home), []);
});
