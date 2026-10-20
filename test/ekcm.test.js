import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEkcmPrices, fetchEkcmPrices } from '../src/ekcm.js';
import { SOURCES } from '../src/prices.js';

const extra = { SALE_UNIT_GB_CD: '4', SALE_STAT_CD: '10', REAL_UCOST: 110000, USE_ENAB_WGT: 3.9, LSPRD_GRD_NM: '1++', STK_QTY: 1 };
const row = { goodsNo: '28225168', goodsNm: '과연한우거세부채살', dispLoginYn: 'N', salePrc: '429000', extraData: JSON.stringify(extra) };
const payload = rows => ({ code: '0000', error: false, payload: { searchDataList: rows, totalCount: rows.length } });
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
  for (const invalid of [{ ...row, dispLoginYn: 'Y' }, { ...row, extraData: '{}' }, { ...row, extraData: 'bad' }, { ...row, extraData: JSON.stringify({ ...extra, REAL_UCOST: 0 }) }]) {
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
test('EKCM collects every page with no keyword restriction and reports coverage', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => ({ ...row, goodsNo: String(i + 1) }));
  let coverage;
  const offsets = [];
  const items = await fetchEkcmPrices(SOURCES[0], async address => {
    if (address.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const url = new URL(address), from = Number(url.searchParams.get('from'));
    assert.equal(url.searchParams.get('searchWord'), '');
    offsets.push(from);
    return Response.json({ code: '0000', payload: { totalCount: 251, searchDataList: rows.slice(from, from + 250) } });
  }, { delayMs: 0, onComplete: value => { coverage = value; } });
  assert.equal(items.length, 251);
  assert.deepEqual(offsets, [0, 250, 0]);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.scanned, 251);
});
test('EKCM covers categories beyond the 10000 result window using distinct product sort', async () => {
  const rows = Array.from({ length: 10001 }, (_, i) => ({ ...row, goodsNo: String(i + 1) }));
  const items = await fetchEkcmPrices(SOURCES[0], async address => {
    if (address.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const url = new URL(address), from = Number(url.searchParams.get('from'));
    assert.ok(from < 10000);
    assert.equal(url.searchParams.get('sortField'), 'goodsNo.keyword');
    const list = url.searchParams.get('sort') === 'asc' ? rows : [...rows].reverse();
    return Response.json({ code: '0000', payload: { totalCount: rows.length, lrgCtgGrpNoCnt: [{ 1: rows.length }], searchDataList: list.slice(from, from + 250) } });
  }, { delayMs: 0 });
  assert.equal(items.length, 10001);
});
test('EKCM never marks a truncated or repeating catalog as complete', async () => {
  let complete = false;
  await assert.rejects(fetchEkcmPrices(SOURCES[0], async address => address.endsWith('/robots.txt') ? new Response('', { status: 404 }) : Response.json({ code: '0000', payload: { totalCount: 2, searchDataList: [row] } }), { delayMs: 0, onComplete: () => { complete = true; } }), /전체 목록 검증 실패/);
  assert.equal(complete, false);
});
test('EKCM retains explicit non-weight sale units without treating totals as kg prices', () => {
  const [item] = parseEkcmPrices(payload([{ ...row, extraData: JSON.stringify({ ...extra, SALE_UNIT_GB_CD: '1', SALE_UNIT_GB_NM: '박스' }) }]), SOURCES[0]);
  assert.equal(item.price, 429000);
  assert.equal(item.unit, '박스');
});

test('EKCM records inventory changes without discarding a completed scan', async () => {
  let requests = 0, coverage;
  const items = await fetchEkcmPrices(SOURCES[0], async address => {
    if (address.endsWith('/robots.txt')) return new Response('', { status: 404 });
    requests++;
    return Response.json({ code: '0000', payload: { totalCount: requests === 1 ? 1 : 2, searchDataList: [row] } });
  }, { delayMs: 0, onComplete: value => { coverage = value; } });
  assert.equal(items.length, 1);
  assert.equal(coverage.sourceTotalAtStart, 1);
  assert.equal(coverage.sourceTotal, 2);
  assert.equal(coverage.changedDuringCollection, true);
});
