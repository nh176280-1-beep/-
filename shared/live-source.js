import {load} from 'cheerio/slim';
import robotsParser from 'robots-parser';
import {SOURCES,fetchPage,parsePrices,validateUrl} from './prices.js';
import {parseEkcmPrices} from './ekcm.js';
import {describe,matches} from './conditions.js';
const API={host:'gw.ekcm.co.kr'};
const robotsCache=new Map();
export async function allowed(url,source,fetcher=fetch){
 const origin=new URL(url).origin,key=origin;let entry=robotsCache.get(key);
 if(!entry||entry.until<Date.now()){
  let text='';try{text=(await fetchPage(origin+'/robots.txt',source,fetcher)).html;}catch(e){if(!e.message.includes('HTTP 404'))throw e;}
  entry={text,until:Date.now()+300000};robotsCache.set(key,entry);
 }
 if(robotsParser(origin+'/robots.txt',entry.text).isAllowed(url,'DaeguPriceBoard')===false)throw Error('원본 robots.txt에서 이 조회를 허용하지 않습니다.');
}
export async function searchSource(id,c,fetcher=fetch){
 const source=SOURCES.find(s=>s.id===id);if(!source)throw Error('판매처를 확인하세요.');
 let items,rawCount,total,hasMore;
 if(id==='ekcm'){
  const codes={'1++':'A','1+':'B','1':'1','2':'2','3':'3'};
  const word=[c.species==='한우'?'한우':'',c.part,c.q,c.storage].filter(Boolean).join(' ');
  const url=new URL('https://gw.ekcm.co.kr/api/goods/v1/search/product');
  url.search=new URLSearchParams({searchWord:word,langCd:'ko',page:String(c.page),aplyPsbMediaCd:'01',filters:c.grade?'lsprdGrdCd:'+codes[c.grade]:'',sort:'desc',sortField:'goodsNo.keyword',from:String((c.page-1)*250),size:'250'}).toString();
  await allowed(url.href,API,fetcher);const page=await fetchPage(url.href,API,fetcher,{accept:'application/json'}),data=JSON.parse(page.html);
  items=parseEkcmPrices(data,source);total=Number(data.payload.totalCount);rawCount=data.payload.searchDataList.length;hasMore=c.page*250<Math.min(total,10000);
 }else{
  // The original shop treats spaces as a literal phrase. Search a part, then apply explicit conditions locally.
  const word=c.part||c.q.split(/\s+/).sort((a,b)=>b.length-a.length)[0];
  const url=new URL('/goods/search_list',source.home);url.search=new URLSearchParams({searchMode:'search',osearchtext:word,search_text:word,per:'200',sorting:'regist',page:String(c.page),auto:'1'}).toString();
  await allowed(url.href,source,fetcher);const page=await fetchPage(url.href,source,fetcher),$=load(page.html);
  const raw=page.html.match(/\.html\(['"]([\d,]+)['"]\)/)?.[1];if(raw===undefined)throw Error('일품한우 검색 건수를 확인할 수 없습니다.');
  total=Number(raw.replaceAll(',',''));rawCount=$('li.goods_list_style1 .goods_name_area a[href]').length;items=parsePrices(page.html,source,page.url);hasMore=rawCount>=200&&c.page*200<total;
 }
 if(!Number.isSafeInteger(total)||total<0)throw Error('원본 검색 건수 응답을 확인하세요.');
 const checkedAt=new Date().toISOString();
 return {sourceId:id,name:source.name,status:'live',checkedAt,items:items.map(describe).filter(item=>matches(item,c)).map(item=>({...item,checkedAt})),rawCount,sourceTotal:total,hasMore,page:c.page,scope:'조건 검색의 원본 한 페이지. 비교 가격 범위는 표시 결과 기준입니다.'};
}
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
