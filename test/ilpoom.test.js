import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchIlpoomPrices } from '../src/ilpoom.js';
import { SOURCES } from '../src/prices.js';

const home = '<a class="categoryDepthLink" href="/goods/catalog?category=c0008">한우 거세</a>';
const card = id => `<li class="goods_list_style1"><div class="goods_name_area"><a href="/goods/view?no=${id}">한우채끝/거세/2[냉장]</a></div><div class="goods_price_area">kg당 <b class="num">63,053</b>원 / 3.70kg</div><div class="goods_price_area"><b class="num">233,290</b>원</div></li>`;
test('ilpoom scans all catalog pages using the actual AJAX product markup', async () => {
  let coverage;
  const pages = [];
  const items = await fetchIlpoomPrices(SOURCES[1], home, '', async address => {
    const url = new URL(address), page = Number(url.searchParams.get('page'));
    pages.push(page);
    const ids = page === 1 ? Array.from({ length: 200 }, (_, i) => i + 1) : [201];
    return new Response(`<ul>${ids.map(card).join('')}</ul><script>$("a.total span.num").html('201');</script>`);
  }, { delayMs: 0, onComplete: value => { coverage = value; } });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(items.length, 201);
  assert.equal(items[0].price, 63053);
  assert.equal(items[0].totalPrice, 233290);
  assert.equal(coverage.scanned, 201);
});
test('ilpoom exposes source count mismatches and checks robots for AJAX routes', async () => {
  let coverage;
  const items = await fetchIlpoomPrices(SOURCES[1], home, '', async () => new Response(`<ul>${card(1)}</ul><script>x.html('2')</script>`), { delayMs: 0, onComplete: value => { coverage = value; } });
  assert.equal(items.length, 1);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.unavailableCount, 1);
  await assert.rejects(fetchIlpoomPrices(SOURCES[1], home, 'User-agent: *\nDisallow: /goods/search_list', async () => { throw new Error('should not request'); }), /robots/);
});
