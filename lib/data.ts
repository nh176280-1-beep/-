import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {chunks,seedSources} from './seed';
export const database=():any=>{const db=(env as any).DB;if(!db)throw new Error('영구 저장소 연결을 확인하고 있습니다.');return db;};
export async function identity(request?:Request){
 const person=await getChatGPTUser();
 if(!person){
  const saved=request?.headers.get('cookie')?.match(/(?:^|;\s*)price_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const visitor=saved||crypto.randomUUID();
  return {id:'guest:'+visitor,name:'방문자',role:'viewer',service:!request,guest:true,newVisitor:!saved,visitor};
 }
 const db=database();
 const owner=await db.prepare("SELECT value FROM config WHERE key='owner'").first();
 return {id:person.userId,name:person.displayName,role:owner?.value===person.userId?'admin':'staff',service:false};
}
export async function insertItems(db:any,generation:string,source:string,items:any[]){
 if(!['ekcm','ilpoom'].includes(source)||!Array.isArray(items))throw new Error('잘못된 상품 데이터입니다.');
 await db.prepare(`INSERT INTO products(generation,source,id,name,search,data)
 SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.name'),lower(json_extract(value,'$.name')||' '||coalesce(json_extract(value,'$.grade'),'')||' '||coalesce(json_extract(value,'$.unit'),'')),value FROM json_each(?) WHERE 1
 ON CONFLICT(generation,source,id) DO UPDATE SET name=excluded.name,search=excluded.search,data=excluded.data`).bind(generation,source,JSON.stringify(items)).run();
}
export async function bootstrap(){
 const db=database();const old=await db.prepare("SELECT value FROM config WHERE key='seed_chunk'").first();
 let next=Number(old?.value||0);let count=0;
 while(next<chunks.length && count<5){
  const compressed=Uint8Array.from(atob(chunks[next]),c=>c.charCodeAt(0));
  const data=JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  await insertItems(db,'seed-20261020',data.source,data.items);
  next++;count++;
  await db.prepare("INSERT INTO config(key,value) VALUES('seed_chunk',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(excluded.value AS INTEGER)>CAST(config.value AS INTEGER)").bind(String(next)).run();
 }
 if(next===chunks.length){
  for(const [source,state] of Object.entries(seedSources) as any){
   const n=await db.prepare("SELECT count(*) AS n FROM products WHERE generation='seed-20261020' AND source=?").bind(source).first();
   if(n.n!==state.count)throw new Error('초기 가격 데이터 건수 검증 실패');
   await db.prepare("INSERT OR IGNORE INTO sources(id,generation,status,coverage,checked_at,message) VALUES(?,?,?,?,?,?)").bind(source,'seed-20261020',state.status,JSON.stringify(state.coverage),state.lastSuccess,state.message).run();
  }
 }
 return {ready:next===chunks.length,importedChunks:next,totalChunks:chunks.length};
}
export async function sourceStates(){const db=database();const r=await db.prepare('SELECT * FROM sources').all();return r.results.map((s:any)=>({...s,count:JSON.parse(s.coverage).priceCount,coverage:JSON.parse(s.coverage),name:s.id==='ekcm'?'금천미트':'일품한우'}));}
export async function listing(user:any,url:URL){
 const db=database();const source=url.searchParams.get('source')||'all',q=(url.searchParams.get('q')||'').trim().slice(0,200),page=Math.max(1,Number(url.searchParams.get('page')||1)||1),favorites=url.searchParams.get('favorites')==='1';
 const where=['p.generation=s.generation'],values:any[]=[];
 if(source!=='all'){where.push('p.source=?');values.push(source);}
 if(q){where.push("p.search LIKE ? ESCAPE '\\'");values.push('%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%');}
 if(favorites){where.push('EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.source=p.source AND f.product_id=p.id)');values.push(user.id);}
 const clause=where.join(' AND '),join=' FROM products p JOIN sources s ON s.id=p.source ';
 const total=await db.prepare('SELECT count(*) AS n'+join+'WHERE '+clause).bind(...values).first();
 const rows=await db.prepare('SELECT p.data,EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.source=p.source AND f.product_id=p.id) AS favorite'+join+'WHERE '+clause+' ORDER BY p.name,p.id LIMIT 100 OFFSET ?').bind(user.id,...values,(page-1)*100).all();
 const favoriteCount=await db.prepare('SELECT count(*) AS n FROM favorites WHERE user_id=?').bind(user.id).first();
 return {items:rows.results.map((r:any)=>({...JSON.parse(r.data),favorite:!!r.favorite})),total:total.n,page,pageCount:Math.max(1,Math.ceil(total.n/100)),favoriteCount:favoriteCount.n,sources:await sourceStates()};
}
