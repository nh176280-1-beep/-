import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEkcmPrices, fetchEkcmPrices } from '../src/ekcm.js';
import { SOURCES } from '../src/prices.js';

const extra = { SALE_UNIT_GB_CD: '4', SALE_STAT_CD: '10', REAL_UCOST: 110000, USE_ENAB_WGT: 3.9, LSPRD_GRD_NM: '1++', STK_QTY: 1 };
const row = { goodsNo: '28225168', goodsNm: '과연한우거세부채살', dispLoginYn: 'N', salePrc: '429000', extraData: JSON.stringify(extra) };
const payload = rows => ({ code: '0000', error: false, payload: { searchDataList: rows } });
test('EKCM preserves kg price, lot total, grade and distinct product links', () => {
  const items = parseEkcmPrices(payload([row, { ...row, goodsNo: '28224792' }]), SOURCES[0]);
  assert.equal(items.length, 2);
  assert.equal(items[0].price, 110000);
  assert.equal(items[0].totalPrice, 429000);
  assert.equal(items[0].unit, '1kg');
  assert.equal(items[0].lotWeight, '3.9kg');
  assert.equal(items[0].grade, '1++');
  assert.notEqual(items[0].id, items[1].id);
});
test('EKCM excludes private prices, unknown units, malformed metadata and invalid amounts', () => {
  for (const invalid of [{ ...row, dispLoginYn: 'Y' }, { ...row, extraData: '{}' }, { ...row, extraData: 'bad' }, { ...row, extraData: JSON.stringify({ ...extra, SALE_UNIT_GB_CD: '1' }) }, { ...row, extraData: JSON.stringify({ ...extra, REAL_UCOST: 0 }) }]) {
    assert.deepEqual(parseEkcmPrices(payload([invalid]), SOURCES[0]), []);
  }
  assert.throws(() => parseEkcmPrices({ code: '9008', error: true }, SOURCES[0]));
});
test('EKCM respects API robots before requesting search data', async () => {
  const calls = [];
  await assert.rejects(fetchEkcmPrices(SOURCES[0], async url => {
    calls.push(url);
    return new Response('User-agent: *\nDisallow: /api/');
  }), /robots/);
  assert.deepEqual(calls, ['https://gw.ekcm.co.kr/robots.txt']);
});
test('EKCM requests JSON and handles absent API robots rules', async () => {
  const items = await fetchEkcmPrices(SOURCES[0], async (url, options) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(new URL(url).hostname, 'gw.ekcm.co.kr');
    assert.equal(new URL(url).searchParams.get('aplyPsbMediaCd'), '01');
    return Response.json(payload([row]));
  });
  assert.equal(items.length, 1);
});
