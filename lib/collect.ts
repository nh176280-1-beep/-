import {load} from 'cheerio/slim';
import robotsParser from 'robots-parser';
import {database,insertItems} from './data';
import {SOURCES,fetchPage,parsePrices} from '../shared/prices';
import {parseEkcmPrices} from '../shared/ekcm';
const apiSource={host:'gw.ekcm.co.kr'};
const source=(id:string):any=>SOURCES.find((s:any)=>s.id===id);
const now=()=>new Date().toISOString();
async function api(filters='',from=0,sort='desc'){
 const url=new URL('https://gw.ekcm.co.kr/api/goods/v1/search/product');url.search=new URLSearchParams({searchWord:'',langCd:'ko',page:String(Math.floor(from/250)+1),aplyPsbMediaCd:'01',filters,sort,sortField:'goodsNo.keyword',from:String(from),size:'250'}).toString();
 const page=await fetchPage(url.href,apiSource,fetch,{accept:'application/json'});const d=JSON.parse(page.html);parseEkcmPrices(d,source('ekcm'));if(!Number.isSafeInteger(Number(d.payload.totalCount)))throw new Error('원본 상품 수 확인 실패');return d.payload;
}
async function robots(home:string,definition:any){const u=new URL('/robots.txt',home).href;try{return (await fetchPage(u,definition)).html;}catch(e:any){if(e.message.includes('HTTP 404'))return '';throw e;}}
async function mark(job:any,shard:string,ids:string[],items:any[]){const db=database();await db.prepare('INSERT OR IGNORE INTO job_seen(job,shard,product) SELECT ?,?,value FROM json_each(?)').bind(job.id,shard,JSON.stringify(ids)).run();await insertItems(db,job.id,job.state.phase,items);}
async function count(job:any,shard?:string){const db=database();return Number((await (shard?db.prepare('SELECT count(*) AS n FROM job_seen WHERE job=? AND shard=?').bind(job.id,shard):db.prepare('SELECT count(DISTINCT product) AS n FROM job_seen WHERE job=? AND shard LIKE ?').bind(job.id,job.state.phase+':%')).first()).n);}
async function activate(job:any,reported:number,missing=0){
 const db=database(),id=job.state.phase,scanned=await count(job),prices=Number((await db.prepare('SELECT count(*) AS n FROM products WHERE generation=? AND source=?').bind(job.id,id).first()).n);
 const coverage={complete:missing===0,scanned,sourceTotal:reported,sourceTotalAtStart:job.state.expected,changedDuringCollection:job.state.expected!==reported,priceCount:prices,excludedCount:scanned-prices,unavailableCount:missing,pages:job.state.pages};
 if(id==='ekcm'&&scanned<Math.min(reported,job.state.expected))throw new Error(`전체 목록 검증 실패: 원본 ${reported}개, 조회 ${scanned}개`);
 const previous=await db.prepare('SELECT coverage FROM sources WHERE id=?').bind(id).first();
 if(missing&&previous&&JSON.parse(previous.coverage).complete)throw new Error('원본 목록 일부가 누락되어 이전 전체 가격을 유지합니다.');
 const message=`상품 ${scanned.toLocaleString('ko-KR')}개 확인 · 공개 가격 ${prices.toLocaleString('ko-KR')}개${missing?' · 원본 목록 차이 '+missing+'개 (전체 완료 아님)':''}`;
 await db.prepare('INSERT INTO sources(id,generation,status,coverage,checked_at,message) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,status=excluded.status,coverage=excluded.coverage,checked_at=excluded.checked_at,message=excluded.message').bind(id,job.id,missing?'partial':'ok',JSON.stringify(coverage),now(),message).run();
 // Keep the active generation and discard retired versions of this source.
 await db.prepare("DELETE FROM products WHERE source=? AND generation<>? AND generation<>'live'").bind(id,job.id).run();
 job.state= id==='ekcm'&&job.state.source==='all'?{phase:'ilpoom',source:'all',init:false,pages:0}:{phase:'done',source:job.state.source,pages:job.state.pages};
}
async function advance(job:any){
 const s=job.state;
 if(s.phase==='ekcm'){
  if(!s.init){const text=await robots('https://gw.ekcm.co.kr/',apiSource);if(robotsParser('https://gw.ekcm.co.kr/robots.txt',text).isAllowed('https://gw.ekcm.co.kr/api/goods/v1/search/product','DaeguPriceBoard')===false)throw new Error('금천미트 API robots.txt 수집 금지');const root=await api();s.expected=Number(root.totalCount);s.shards=s.expected<=10000?['']:root.lrgCtgGrpNoCnt.flatMap((x:any)=>Object.keys(x).map(k=>'lrgCtgNo:'+k));if(!s.shards.length)throw new Error('전체 카테고리 확인 실패');Object.assign(s,{init:true,index:0,from:0,sort:'desc',pages:0,total:0});return;}
  if(s.index>=s.shards.length){const latest=await api();await mark(job,'ekcm:head',latest.searchDataList.map((r:any)=>String(r.goodsNo)),parseEkcmPrices({code:'0000',payload:latest},source('ekcm')));await activate(job,Number(latest.totalCount));return;}
  const filters=s.shards[s.index];
  // First page establishes this shard's bound; subsequent pages run four at a time.
  const limit=Math.min(s.total||250,10000);
  const offsets=Array.from({length:Math.min(4,Math.ceil((limit-s.from)/250))},(_,i)=>s.from+i*250);
  const pages=await Promise.allSettled(offsets.map(offset=>api(filters,offset,s.sort)));
  const failed=pages.find(p=>p.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  const payloads=pages.map(p=>(p as PromiseFulfilledResult<any>).value);
  if(payloads.some(p=>Number(p.totalCount)>20000))throw new Error('카테고리 검색 상한 변경: 추가 분할이 필요합니다. 이전 가격을 유지합니다.');
  if(payloads.some(p=>Number(p.totalCount)&&!p.searchDataList.length))throw new Error('전체 수집 중 빈 페이지 반환');
  if(s.from===0&&s.sort==='desc')s.total=Number(payloads[0].totalCount);
  await mark(job,'ekcm:'+filters,payloads.flatMap(p=>p.searchDataList.map((r:any)=>String(r.goodsNo))),payloads.flatMap(p=>parseEkcmPrices({code:'0000',payload:p},source('ekcm'))));s.pages+=pages.length;
  const n=await count(job,'ekcm:'+filters);
  if(n>=s.total){s.index++;s.from=0;s.sort='desc';s.total=0;}
  else {s.from+=250*pages.length;if(s.from>=Math.min(s.total,10000)){if(s.sort==='asc')throw new Error('전체 카테고리 목록 건수가 일치하지 않습니다.');s.sort='asc';s.from=0;}}
  s.progress=`금천미트 · ${await count(job)}개 확인 / 시작 ${s.expected}개 · ${s.index}/${s.shards.length} 카테고리`;
 }else if(s.phase==='ilpoom'){
  const def=source('ilpoom');
  if(!s.init){s.robots=await robots(def.home,def);const home=await fetchPage(def.home,def);const $=load(home.html);const c=new Set<string>();$('a.categoryDepthLink[href]').each((_:any,a:any)=>{const u=new URL($(a).attr('href')!,def.home);if(u.pathname==='/goods/catalog'&&/^c\d+$/.test(u.searchParams.get('category')||''))c.add(u.searchParams.get('category')!);});if(!c.size)throw new Error('일품한우 전체 카테고리 확인 실패');Object.assign(s,{init:true,categories:[...c],index:0,page:1,total:0,expected:0,missing:0});return;}
  if(s.index>=s.categories.length){await activate(job,s.expected,s.missing);return;}
  const category=s.categories[s.index];
  const numbers=Array.from({length:s.page===1?1:Math.min(4,Math.max(1,Math.ceil(s.total/200)-s.page+1))},(_,i)=>s.page+i);
  const results=await Promise.allSettled(numbers.map(async number=>{
   const u=new URL('/goods/search_list',def.home);u.search=new URLSearchParams({searchMode:'catalog',category,per:'200',sorting:'regist',page:String(number),auto:'1'}).toString();
   if(robotsParser(new URL('/robots.txt',def.home).href,s.robots).isAllowed(u.href,'DaeguPriceBoard')===false)throw new Error('일품한우 robots.txt 수집 금지');
   const page=await fetchPage(u.href,def),$=load(page.html),raw=page.html.match(/\.html\(['"]([\d,]+)['"]\)/)?.[1];if(raw===undefined)throw new Error('일품한우 전체 상품 수 확인 실패');
   const ids:string[]=[];$('li.goods_list_style1 .goods_name_area a[href]').each((_:any,a:any)=>{const id=new URL($(a).attr('href')!,def.home).searchParams.get('no');if(id)ids.push(id);});
   return {ids,total:Number(raw.replaceAll(',','')),items:parsePrices(page.html,def,page.url)};
  }));
  const failed=results.find(p=>p.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  const pages=results.map(p=>(p as PromiseFulfilledResult<any>).value);
  if(s.page===1){s.total=pages[0].total;s.expected+=s.total;}
  const before=await count(job,'ilpoom:'+category);
  await mark(job,'ilpoom:'+category,pages.flatMap(p=>p.ids),pages.flatMap(p=>p.items));s.pages+=pages.length;
  const n=await count(job,'ilpoom:'+category);
  if(n>=s.total||pages.some(p=>p.ids.length<200)||s.page+pages.length>Math.ceil(s.total/200)){s.missing+=Math.max(0,s.total-n);s.index++;s.page=1;s.total=0;}
  else {if(n===before)throw new Error('일품한우 목록이 반복되거나 누락되었습니다.');s.page+=pages.length;}
  s.progress=`일품한우 · ${await count(job)}개 확인 · ${s.index}/${s.categories.length} 카테고리`;
 }
}
export async function jobStatus(id?:string){const db=database();const r=await (id?db.prepare('SELECT * FROM jobs WHERE id=?').bind(id):db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 1')).first();return r?{id:r.id,status:r.status,error:r.error,source:JSON.parse(r.state).source||'all',progress:JSON.parse(r.state).progress||JSON.parse(r.state).phase}:null;}
export async function jobStatuses(){const rows=await database().prepare("SELECT id FROM jobs WHERE status='running' ORDER BY updated_at DESC LIMIT 5").all();return Promise.all(rows.results.map((r:any)=>jobStatus(r.id)));}
export async function start(source='all'){
 if(!['all','ekcm','ilpoom'].includes(source))throw Error('수집할 판매처를 확인하세요.');
 const db=database(),condition="status='running' AND (coalesce(json_extract(state,'$.source'),'all') IN (?,'all') OR ?='all')";
 const running=await db.prepare('SELECT id FROM jobs WHERE '+condition+' LIMIT 1').bind(source,source).first();if(running)return jobStatus(running.id);
 const id='collect-'+crypto.randomUUID();
 await db.prepare("INSERT INTO jobs(id,state,status,updated_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE "+condition+')').bind(id,JSON.stringify({phase:source==='all'?'ekcm':source,source,init:false,pages:0}),'running',now(),source,source).run();
 return await jobStatus(id)||jobStatus();
}
export async function step(id:string){
 const db=database(),lease=Date.now()+60000;
 const r=await db.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND status='running' AND lease_until<? RETURNING *").bind(lease,id,Date.now()).first();if(!r)return jobStatus(id);
 const job={id,state:JSON.parse(r.state)};job.state.source||='all';let error=null,status='running',deadline=Date.now()+18000;
 try {for(let i=0;i<10&&Date.now()<deadline;i++){await advance(job);job.state.retries=0;await db.prepare('UPDATE jobs SET state=?,updated_at=? WHERE id=?').bind(JSON.stringify(job.state),now(),id).run();if(job.state.phase==='done'){status='done';break;}await new Promise(r=>setTimeout(r,100));}}
 catch(e:any){const retry=(job.state.retries||0)+1;job.state.retries=retry;if(retry>=3||!(/HTTP (429|5\d\d)|fetch failed|timeout|Timeout/.test(e.message))){error=e.message;status='error';}else job.state.progress='원본 서버 일시 오류 · 재시도 '+retry+'/3';}
 await db.prepare('UPDATE jobs SET state=?,status=?,error=?,lease_until=0,updated_at=? WHERE id=?').bind(JSON.stringify(job.state),status,error,now(),id).run();if(status==='done')await db.prepare('DELETE FROM job_seen WHERE job=?').bind(id).run();return jobStatus(id);
}
