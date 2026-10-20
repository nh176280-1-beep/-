import {identity,database,bootstrap,listing,sourceStates} from '../../../lib/data';
import {jobStatus,jobStatuses,start,step} from '../../../lib/collect';
import {liveSearch,liveDetail,auditLog,limit} from '../../../lib/live';
export const dynamic='force-dynamic';
async function bodyOf(request:Request){
 if(Number(request.headers.get('content-length')||0)>16384)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});
 const text=await request.text();if(text.length>16384)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});
 const body=JSON.parse(text||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error('요청 형식을 확인하세요.');return body;
}
async function respond(request:Request,user:any){try{
 const url=new URL(request.url),path=url.pathname;
 if(request.method!=='GET'){
  const origin=request.headers.get('origin');if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'허용되지 않은 요청 출처입니다.'},{status:403});
 }
 if(path==='/api/me'&&request.method==='GET')return Response.json({user});
 if(path==='/api/status'&&request.method==='GET'){const sources=await sourceStates();return Response.json({ready:sources.length===2,job:await jobStatus(),jobs:await jobStatuses(),sources});}
 if(path==='/api/prices'&&request.method==='GET')return Response.json(await listing(user,url));
 if(path==='/api/live'&&request.method==='POST')return Response.json(await liveSearch(user,await bodyOf(request)));
 if(path==='/api/detail'&&request.method==='POST')return Response.json(await liveDetail(user,await bodyOf(request)));
 if(path==='/api/favorite'&&request.method==='POST'){
  if(user.service)return Response.json({error:'방문자 세션을 확인하세요.'},{status:401});await limit('favorite:'+user.id,40);
  const body=await bodyOf(request);if(!['ekcm','ilpoom'].includes(body.source)||!/^\w{20}$/.test(String(body.id))||typeof body.saved!=='boolean')throw Error('상품을 확인하세요.');
  const db=database();
  if(body.saved){
   const exists=await db.prepare("SELECT 1 AS n FROM products WHERE source=? AND id=? LIMIT 1").bind(body.source,body.id).first()||await db.prepare("SELECT 1 AS n FROM live_cache c,json_each(c.payload,'$.items') j WHERE json_extract(j.value,'$.sourceId')=? AND json_extract(j.value,'$.id')=? LIMIT 1").bind(body.source,body.id).first();
   if(!exists)throw Error('확인된 목록의 상품만 저장할 수 있습니다.');
   const count=await db.prepare('SELECT count(*) AS n FROM favorites WHERE user_id=?').bind(user.id).first();if(count.n>=200)throw Error('관심 품목은 최대 200개입니다.');
   await db.prepare('INSERT OR IGNORE INTO favorites(user_id,source,product_id) VALUES(?,?,?)').bind(user.id,body.source,body.id).run();
  }else await db.prepare('DELETE FROM favorites WHERE user_id=? AND source=? AND product_id=?').bind(user.id,body.source,body.id).run();return Response.json({ok:true});
 }
 if(user.role!=='admin')return Response.json({error:'관리자만 사용할 수 있습니다.'},{status:403});
 if(path==='/api/audit'&&request.method==='GET')return Response.json({rows:await auditLog()});
 if(path==='/api/bootstrap'&&request.method==='POST')return Response.json(await bootstrap());
 if(path==='/api/refresh'&&request.method==='POST')return Response.json(await start((await bodyOf(request)).source||'all'));
 if(path==='/api/refresh/step'&&request.method==='POST'){const body=await bodyOf(request);if(typeof body.id!=='string'||body.id.length>100)throw Error('수집 작업을 확인하세요.');return Response.json(await step(body.id));}
 return Response.json({error:'요청을 찾을 수 없습니다.'},{status:404});
 }catch(e:any){return Response.json({error:e.message||'서버 처리 오류'},{status:e.status||400});}}
async function handle(request:Request){
 try{const user=await identity(request),response=await respond(request,user);
 response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 if(user.guest&&user.newVisitor)response.headers.append('Set-Cookie',`price_visitor=${user.visitor}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
 return response;}catch{return Response.json({error:'저장소 또는 인증 연결을 확인하세요.'},{status:503});}
}
export {handle as GET,handle as POST};
