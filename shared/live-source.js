import {load} from 'cheerio/slim';
import robotsParser from 'robots-parser';
import {SOURCES,fetchPage,parsePrices,validateUrl} from './prices.js';
import {parseEkcmPrices} from './ekcm.js';
import {describe,matches} from './conditions.js';
export {allowed} from './source-access.js';
import {allowed} from './source-access.js';
export {searchSource} from './category-source.js';
export function parseDetail(html,id){
 const $=load(html),fields={};
 const save=(label,value)=>{label=label.replace(/\s+/g,'');value=value.replace(/\s+/g,' ').trim().slice(0,250);if(value&&/^(생산일자|생산일|제조일자|제조일|유통기한|소비기한|보관방법|원산지)$/.test(label))fields[label]=value;};
 $('.detail_spec_table').each((_,row)=>save($(row).find('.th').text(),$(row).find('.td').text()));
 $('tr').each((_,row)=>{const cells=$(row).children('th,td');if(cells.length===2)save($(cells[0]).text(),$(cells[1]).text());});
 return {sourceId:id,productionDate:fields['생산일자']||fields['생산일']||fields['제조일자']||fields['제조일']||'',expiryDate:fields['유통기한']||fields['소비기한']||'',expiryLabel:fields['유통기한']?'유통기한':fields['소비기한']?'소비기한':'유통기한',storageInfo:fields['보관방법']||'',origin:fields['원산지']||'',priceVerified:false,note:'상세 정보 확인입니다. 가격은 조건 검색 확인 시각을 확인하세요.'};
}
export function detailURL(id,goodsNo){
 if(!/^\d{1,20}$/.test(String(goodsNo)))throw Error('올바른 상품번호가 필요합니다.');
 const source=SOURCES.find(s=>s.id===id);if(!source)throw Error('판매처를 확인하세요.');
 return {source,url:validateUrl(id==='ekcm'?`https://www.ekcm.co.kr/pd/productDetail?goodsNo=${goodsNo}`:`https://www.ilpoomhanwoo.com/goods/view?no=${goodsNo}`,source)};
}
export async function detailSource(id,goodsNo,fetcher=fetch){
 const {source,url}=detailURL(id,goodsNo);await allowed(url,source,fetcher);const page=await fetchPage(url,source,fetcher);
 return {...parseDetail(page.html,id),goodsNo:String(goodsNo),url,checkedAt:new Date().toISOString()};
}
