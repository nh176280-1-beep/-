import {createHash} from 'node:crypto';
import {database,listing,insertItems} from './data';
import {criteria,comparableGroups} from '../shared/conditions';
import {searchSource,detailSource,detailURL} from '../shared/live-source';
const inFlight=new Map<string,Promise<any>>();
export async function limit(key:string,maximum=12,seconds=60){
 const db=database(),window=Math.floor(Date.now()/(seconds*1000));
 const row=await db.prepare(`INSERT INTO request_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN request_limits.window=excluded.window THEN request_limits.count+1 ELSE 1 END RETURNING count`).bind(key,window).first();
 await db.prepare('DELETE FROM request_limits WHERE window<?').bind(window-1440).run();
 if(row.count>maximum)throw Object.assign(Error('요청이 많습니다. 잠시 후 다시 시도하세요.'),{status:429});
}
async function cached(key:string,fetcher:()=>Promise<any>){
 if(inFlight.has(key))return inFlight.get(key);
 const promise=(async()=>{
  const db=database();let old=await db.prepare('SELECT * FROM live_cache WHERE key=?').bind(key).first();
  if(old?.payload&&Date.now()-Date.parse(old.checked_at)<15000)return {...JSON.parse(old.payload),status:'cached'};
  await db.prepare('INSERT OR IGNORE INTO live_cache(key) VALUES(?)').bind(key).run();
  const lock=await db.prepare('UPDATE live_cache SET lease_until=? WHERE key=? AND lease_until<? RETURNING key').bind(Date.now()+45000,key,Date.now()).first();
  if(!lock){if(old?.payload)return {...JSON.parse(old.payload),status:'stale',error:'같은 조건을 확인 중입니다. 마지막 성공 결과를 표시합니다.'};throw Error('같은 조건을 확인 중입니다. 잠시 후 다시 조회하세요.');}
  try{
   await limit('origin:global',90);
   const result=await fetcher();
   await db.prepare('UPDATE live_cache SET payload=?,checked_at=?,lease_until=0 WHERE key=?').bind(JSON.stringify(result),result.checkedAt,key).run();
   return result;
  }catch(e:any){
   await db.prepare('UPDATE live_cache SET lease_until=0 WHERE key=?').bind(key).run();
   if(!old?.payload)await db.prepare('DELETE FROM live_cache WHERE key=? AND payload IS NULL AND lease_until=0').bind(key).run();
   if(old?.payload)return {...JSON.parse(old.payload),status:'stale',error:e.message};throw e;
  }
 })();inFlight.set(key,promise);try{return await promise;}finally{inFlight.delete(key);}
}
async function record(user:any,kind:string,query:any,result:any){
 const db=database();
 await db.prepare('INSERT INTO query_audit(id,actor,kind,query,result,at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),createHash('sha256').update(user.id).digest('hex').slice(0,16),kind,JSON.stringify(query),JSON.stringify(result),new Date().toISOString()).run();
 // These are operational records, not an employee attendance system. Retain 30 days.
 await db.prepare('DELETE FROM query_audit WHERE at<?').bind(new Date(Date.now()-30*86400000).toISOString()).run();
}
export async function liveSearch(user:any,input:any){
 const c=criteria(input);await limit('live:'+user.id,15);
 const sources=await Promise.all(['ekcm','ilpoom'].map(async id=>{
  const key='search:category-v3:'+id+':'+JSON.stringify(c);
  try{return await cached(key,()=>searchSource(id,c));}
  catch(e:any){
   return {sourceId:id,name:id==='ekcm'?'금천미트':'일품한우',status:'error',checkedAt:null,items:[],rawCount:null,sourceTotal:null,hasMore:false,page:1,error:e.message,complete:false,scope:'검증된 원료육 사본이 없습니다. 이전 이름 검색 결과와 저장 목록은 비교에 사용하지 않습니다.'};
  }
 }));
 const favoriteRows=await database().prepare('SELECT source,product_id FROM favorites WHERE user_id=?').bind(user.id).all();
 const favorites=new Set(favoriteRows.results.map((r:any)=>r.source+':'+r.product_id));
 for(const source of sources){
  source.items=source.items.map((item:any)=>({...item,favorite:favorites.has(item.sourceId+':'+item.id)}));
  if(['live','cached','stale'].includes(source.status))await insertItems(database(),'live',source.sourceId,source.items);
 }
 const cutoff=new Date(Date.now()-30*86400000).toISOString();
 await database().prepare('DELETE FROM live_cache WHERE checked_at<? AND lease_until<?').bind(cutoff,Date.now()).run();
 await database().prepare("DELETE FROM products WHERE generation='live' AND json_extract(data,'$.checkedAt')<? AND NOT EXISTS(SELECT 1 FROM favorites f WHERE f.source=products.source AND f.product_id=products.id)").bind(cutoff).run();
 const items=sources.flatMap(s=>s.items);
 await record(user,'search',c,sources.map(s=>({source:s.sourceId,status:s.status,count:s.items.length,error:s.error||null}))).catch(()=>{});
 return {criteria:c,sources,groups:comparableGroups(items),items,servedAt:new Date().toISOString()};
}
export async function liveDetail(user:any,input:any){
 const id=String(input.source||''),goodsNo=String(input.goodsNo||'');detailURL(id,goodsNo);await limit('detail:'+user.id,20);
 let result:any;
 if(id==='ekcm'){
  const row=await database().prepare("SELECT data FROM products WHERE generation='live' AND source='ekcm' AND json_extract(data,'$.goodsNo')=? AND json_extract(data,'$.categoryVerified')=1 ORDER BY json_extract(data,'$.checkedAt') DESC LIMIT 1").bind(goodsNo).first();
  if(row){const item=JSON.parse(row.data);result={sourceId:id,goodsNo,status:'cached',productionDate:item.productionDate||'',expiryDate:item.expiryDate||'',expiryLabel:'소비기한',origin:item.origin||'',traceNo:item.traceNo||'',checkedAt:item.checkedAt,priceVerified:false,note:'원료육 상품 API에서 가격과 함께 확인한 상세 정보입니다.'};}
 }
 if(!result)result=await cached('detail:category-v3:'+id+':'+goodsNo,async()=>({...await detailSource(id,goodsNo),status:'live'}));
 await record(user,'detail',{source:id,goodsNo},{status:result.status}).catch(()=>{});return result;
}
export async function auditLog(){return (await database().prepare('SELECT kind,query,result,at FROM query_audit ORDER BY at DESC LIMIT 100').all()).results;}
