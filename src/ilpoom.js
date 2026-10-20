import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchPage, parsePrices } from './prices.js';

export async function fetchIlpoomPrices(source, homeHtml, robotsText, fetcher, options = {}) {
  const $ = load(homeHtml);
  const categories = new Set();
  $('a.categoryDepthLink[href]').each((_, link) => {
    const url = new URL($(link).attr('href'), source.home);
    if (url.pathname === '/goods/catalog' && /^c\d+$/.test(url.searchParams.get('category') || '')) categories.add(url.searchParams.get('category'));
  });
  if (!categories.size) throw new Error('일품한우 전체 카테고리 목록을 확인할 수 없습니다.');
  const robots = robotsParser(new URL('/robots.txt', source.home).href, robotsText);
  const allRows = new Set(), items = new Map();
  let sourceTotal = 0, pages = 0;
  let unavailableCount = 0;
  for (const category of categories) {
    const seen = new Set();
    let total = null;
    for (let pageNumber = 1; total === null || seen.size < total; pageNumber++) {
      const url = new URL('/goods/search_list', source.home);
      url.search = new URLSearchParams({ searchMode: 'catalog', category, per: '200', sorting: 'regist', page: String(pageNumber), auto: '1' });
      if (robots.isAllowed(url.href, 'DaeguPriceBoard') === false) throw new Error('일품한우 robots.txt에서 전체 상품 수집을 허용하지 않습니다.');
      if (pages) await delay(options.delayMs ?? 200);
      let page;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { page = await fetchPage(url.href, source, fetcher); break; }
        catch (error) {
          if (attempt === 2 || !(/HTTP (429|5\d\d)/.test(error.message) || error.name === 'TimeoutError' || error.message === 'fetch failed')) throw error;
          await delay(1000 * 2 ** attempt);
        }
      }
      const document = load(page.html);
      const count = page.html.match(/\.html\(['"]([\d,]+)['"]\)/)?.[1];
      if (count === undefined) throw new Error('일품한우 전체 상품 수를 확인할 수 없습니다.');
      if (total === null) { total = Number(count.replaceAll(',', '')); sourceTotal += total; }
      const previous = seen.size;
      const links = document('li.goods_list_style1 .goods_name_area a[href]');
      links.each((_, link) => {
        const id = new URL(document(link).attr('href'), source.home).searchParams.get('no');
        if (id) { seen.add(id); allRows.add(id); }
      });
      for (const item of parsePrices(page.html, source, page.url)) items.set(item.id, item);
      pages++;
      options.onProgress?.({ scanned: allRows.size, sourceTotal, pages });
      if (seen.size >= total) break;
      // The origin's cached displayed total can exceed its actual listing.
      // A short final page ends traversal, but must never pass a full-count check.
      if (links.length < 200) { unavailableCount += total - seen.size; break; }
      if (seen.size === previous || pageNumber >= Math.ceil(total / 200) + 1) throw new Error(`일품한우 전체 목록 검증 실패: ${total}개 중 ${seen.size}개 확인.`);
    }
  }
  const result = [...items.values()];
  options.onComplete?.({ complete: unavailableCount === 0, sourceTotal, scanned: allRows.size, priceCount: result.length, excludedCount: allRows.size - result.length, unavailableCount, pages });
  return result;
}
