import {createHash} from 'node:crypto';
import {load} from 'cheerio/slim';
import {SOURCES,fetchPage,parsePrices} from './prices.js';
import {allowed} from './source-access.js';
import {canonicalPart,categoryMatches,normalizedGrade,describe,matches} from './conditions.js';
const API={host:'gw.ekcm.co.kr'},GRADE={'1++':'A','1+':'B','1':'1','2':'2','3':'3'},STORAGE={'냉장':'1','냉동':'2'};
const metaCache=new Map();
export async function mapLimit(list,limit,fn){let next=0;const out=new Array(list.length);await Promise.all(Array.from({length:Math.min(limit,list.length)},async()=>{while(next<list.length){const i=next++;out[i]=await fn(list[i],i);}}));return out;}
async function json(url,source,fetcher,body){
 await allowed(url,source,fetcher);
 const page=await fetchPage(url,source,fetcher,{accept:'application/json',...(body?{method:'POST',body:JSON.stringify(body)}:{})}),data=JSON.parse(page.html);
 if(!Array.isArray(data)&&data.code&&data.code!=='0000')throw Error('원본 API 응답 코드 '+data.code);
 return Array.isArray(data)?data:data.payload??data;
}
async function metadata(key,fn){const hit=metaCache.get(key);if(hit&&Date.now()<hit.until)return hit.value;const value=await fn();metaCache.set(key,{value,until:Date.now()+60000});return value;}
const date=value=>/^\d{8}$/.test(String(value))?String(value).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';
export function ekcmItem(row,group){
 if(row.dispLoginYn!=='N'||String(row.saleUnitGbCd)!=='4'||String(row.saleStatCd)!=='10'||row.saleFnshYn==='Y')return null;
 const price=Number(row.realUcost),weight=Number(row.useEnabWgt),totalPrice=Number(row.salePrc);
 if(!/^\d+$/.test(String(row.goodsNo))||![price,weight,totalPrice].every(x=>Number.isFinite(x)&&x>0))return null;
 const part=canonicalPart(row.plspartNm||(row.artcNm||'').split('/')[2]||'');
 const url=`https://www.ekcm.co.kr/pd/productDetail?goodsNo=${row.goodsNo}`;
 const grade=row.lsprdGrdNm==='1++'&&/^[789]$/.test(String(row.catlInsfatGrdCd))?`1++(${row.catlInsfatGrdCd})`:String(row.lsprdGrdNm||'');
 const name=String(row.goodsNm||'').trim();
 // Preserve existing favorite keys when their original metadata remains unchanged.
 const id=createHash('sha256').update(JSON.stringify(['ekcm',url,name,String(row.lsprdGrdNm||''),'1kg'])).digest('hex').slice(0,20);
 return {id,goodsNo:String(row.goodsNo),sourceId:'ekcm',sourceName:'금천미트',name,price,totalPrice,lotWeight:weight+'kg',unit:'1kg',grade,gradeBasis:'원본 상품 API 등급',storage:String(row.strgMthdGbNm||''),species:group.species,gender:String(row.lventSexGbNm||group.gender||''),part,format:'원료육',categoryVerified:true,categoryNo:String(row.leafCtgNo||''),categoryPath:group.pathNm,classificationText:row.artcNm||'',productionDate:date(row.ppYmd),expiryDate:date(row.distriDlineYmd),expiryLabel:'소비기한',traceNo:row.histNo||'',origin:row.homeNm||'',brand:row.brandNm||'',availability:Number(row.stkQty)>0?'':'품절',method:'원료육 원본 카테고리 상품 API'};
}
async function ekcm(c,fetcher){
 const cats=await metadata('ekcm',()=>json('https://gw.ekcm.co.kr/api/display/v1/displayCategory/getDispCtgList?shopInfwYn=Y',API,fetcher));
 if(!Array.isArray(cats))throw Error('금천미트 카테고리 형식을 확인하세요.');
 const sexes=c.gender==='전체'?['거세','암소']:[c.gender];
 const groupNames=c.species==='한우'?sexes.map(x=>'국내산 한우 '+x):c.species==='육우'?sexes.map(x=>'국내산 육우 '+x):c.species==='돼지'?['국내산 돈육']:['수입냉장우육(전체)','수입냉동우육(전체)'];
 const groups=groupNames.map(name=>cats.find(x=>String(x.depth)==='2'&&x.dispCtgNm===name));
 if(groups.some(x=>!x))throw Error('원료육 카테고리를 찾지 못했습니다.');
 const targets=groups.flatMap(group=>cats.filter(x=>x.leafYn==='Y'&&x.pathNm.startsWith(group.pathNm+',')&&canonicalPart(x.dispCtgNm)===c.part).map(leaf=>({leaf,group:{...group,species:c.species,gender:/거세/.test(group.dispCtgNm)?'거세':/암소/.test(group.dispCtgNm)?'암소':''}})));
 if(!targets.length)throw Error('선택 부위의 원료육 카테고리가 없습니다. 부위를 바꿔 주세요.');
 // Combine only leaves belonging to the same official group; never use product-name search.
 const chunks=[];for(const group of groups){const mine=targets.filter(t=>t.group.dispCtgNo===group.dispCtgNo);for(let i=0;i<mine.length;i+=8)chunks.push(mine.slice(i,i+8));}
 const batches=await mapLimit(chunks,4,async chunk=>{
  const ids=chunk.map(t=>t.leaf.dispCtgNo),rows=[],seen=new Set();let expected=null;
  for(let page=1;page<=40;page++){
   const body=Object.fromEntries(['brandNoList','lsprdGrdCdList','homeCdList','ppYmdList','strgMthdGbCdList','workMethTypCdList','deliProcTypCdList','recomBkindList','artcGbCdList','qualityList','insfatGrdList','mffldList','estNoList'].map(k=>[k,[]]));
   Object.assign(body,{lsprdGrdCdList:c.grade?[GRADE[c.grade]]:[],strgMthdGbCdList:c.storage?[STORAGE[c.storage]]:[],dispCtgNoList:ids,sortTpCd:'60',pageNo:page,pageSize:250,aplyPsbMediaCd:'01',curCtgNo:ids[0],noDispCtgRegYn:'N',mbrNo:''});
   const batch=await json('https://gw.ekcm.co.kr/api/goods/v1/goods/dispGoodsList',API,fetcher,body);
   if(!Array.isArray(batch))throw Error('금천미트 상품 목록 형식이 다릅니다.');
   if(page===1){expected=batch.length?Number(batch[0].totCnt):0;if(!Number.isSafeInteger(expected)||expected<0||expected>10000)throw Error('원본 건수 검증 실패 또는 조회 범위가 큽니다. 조건을 좁혀 주세요.');}
   if(batch.some(row=>!ids.includes(String(row.leafCtgNo))))throw Error('요청 카테고리 밖의 상품이 반환되어 비교를 중단합니다.');
   let added=0;for(const row of batch)if(!seen.has(String(row.goodsNo))){seen.add(String(row.goodsNo));rows.push({...row,__group:chunk[0].group});added++;}
   if(rows.length>=expected)return {rows,expected};
   if(!added)throw Error(`금천미트 목록 누락: 원본 ${expected}, 확인 ${rows.length}`);
  }
  throw Error('금천미트 조회 상한 도달: 전체 결과로 표시하지 않습니다.');
 });
 const raw=[...new Map(batches.flatMap(b=>b.rows).map(r=>[String(r.goodsNo),r])).values()];
 return {items:raw.map(r=>ekcmItem(r,r.__group)).filter(Boolean).map(describe).filter(x=>matches(x,c)),rawCount:raw.length,sourceTotal:batches.reduce((n,b)=>n+b.expected,0),categories:targets.map(t=>({code:t.leaf.dispCtgNo,name:t.leaf.dispCtgNm,path:t.leaf.pathNm})),complete:true};
}
async function ilpoomClass(code,fetcher){return metadata('ilpoom:'+code,async()=>{
 const url=new URL('/goods/search_classification',SOURCES[1].home);url.search=new URLSearchParams({page:'1',searchMode:'catalog',category:'c'+code,per:'40',sorting:'date',classification:'category',category_code:'c'+code,location_code:''}).toString();
 const d=await json(url.href,SOURCES[1],fetcher);if(!Array.isArray(d.category_child))throw Error('일품한우 원본 분류 응답 확인 실패');return d;
 });}
async function ilpoom(c,fetcher){
 if(c.species!=='한우')return {items:[],rawCount:0,sourceTotal:0,categories:[],complete:true,unsupported:true};
 const roots=c.gender==='전체'?['0008','0022']:[c.gender==='암소'?'0022':'0008'];
 const groupTargets=await mapLimit(roots,2,async root=>{
  const cls=await ilpoomClass(root,fetcher);
  // '등심' is a source category containing flower/upper/lower sirloin. Keep those as separate item parts.
  const categories=cls.category_child.filter(x=>categoryMatches(x.category_name,c.part)||(['꽃등심','윗등심','아랫등심'].includes(c.part)&&x.category_name==='등심'));
  const targets=await mapLimit(categories,4,async p=>{
   const gradeClass=c.grade?await ilpoomClass(p.category_code,fetcher):null;
   const selected=gradeClass?.category_child?.length?gradeClass.category_child.filter(g=>normalizedGrade(g.category_name)===c.grade):[p];
   return selected.map(t=>({code:t.category_code,path:`${root==='0008'?'한우 거세':'한우 암소'} / ${p.category_name} / ${c.grade||'전체 등급'}`,gender:root==='0008'?'거세':'암소'}));
  });return targets.flat();
 });
 const targets=groupTargets.flat();if(!targets.length)return {items:[],rawCount:0,sourceTotal:0,categories:[],complete:true};
 const batches=await mapLimit(targets,4,async t=>{
  const items=[],seen=new Set();let expected=null;
  for(let pageNo=1;pageNo<=40;pageNo++){
   const url=new URL('/goods/search_list',SOURCES[1].home);url.search=new URLSearchParams({page:String(pageNo),searchMode:'catalog',category:'c'+t.code,per:'200',sorting:'regist',auto:'1'}).toString();
   await allowed(url.href,SOURCES[1],fetcher);const page=await fetchPage(url.href,SOURCES[1],fetcher),$=load(page.html);
   const value=page.html.match(/\.html\(['"]([\d,]+)['"]\)/)?.[1];if(value===undefined)throw Error('일품한우 목록 건수 확인 실패');
   if(expected===null){expected=Number(value.replaceAll(',',''));if(expected>8000)throw Error('조회 범위가 큽니다. 조건을 좁혀 주세요.');}
   const ids=$('li.goods_list_style1 .goods_name_area a[href]').toArray().map(a=>new URL($(a).attr('href'),url).searchParams.get('no')).filter(Boolean);let added=0;for(const id of ids)if(!seen.has(id)){seen.add(id);added++;}
   items.push(...parsePrices(page.html,SOURCES[1],page.url).map(x=>describe({...x,gender:t.gender,species:'한우',format:'원료육',categoryVerified:true,categoryNo:t.code,categoryPath:t.path})));
   if(seen.size>=expected)return {items,rawCount:seen.size,expected};
   if(!added||ids.length<200)throw Error(`일품한우 목록 누락: 원본 ${expected}, 확인 ${seen.size}`);
  }throw Error('일품한우 조회 상한 도달: 전체 결과로 표시하지 않습니다.');
 });
 const items=[...new Map(batches.flatMap(b=>b.items).map(x=>[x.goodsNo,x])).values()].filter(x=>matches(x,c));
 return {items,rawCount:batches.reduce((n,b)=>n+b.rawCount,0),sourceTotal:batches.reduce((n,b)=>n+b.expected,0),categories:targets,complete:true};
}
export async function searchSource(id,c,fetcher=fetch){
 const result=id==='ekcm'?await ekcm(c,fetcher):id==='ilpoom'?await ilpoom(c,fetcher):null;if(!result)throw Error('판매처를 확인하세요.');
 const checkedAt=new Date().toISOString();return {...result,sourceId:id,name:id==='ekcm'?'금천미트':'일품한우',status:result.unsupported?'unsupported':'live',checkedAt,items:result.items.map(item=>({...item,checkedAt})),hasMore:false,page:1,scope:'선택한 원료육 카테고리의 전체 페이지 검증 · 세부 부위별 별도 비교'};
}
