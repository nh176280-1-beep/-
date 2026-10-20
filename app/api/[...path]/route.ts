import {identity,database,bootstrap,listing,sourceStates} from '../../../lib/data';
import {jobStatus,start,step} from '../../../lib/collect';
export const dynamic='force-dynamic';
async function respond(request:Request,user:any){try{
 const url=new URL(request.url),path=url.pathname;
 if(request.method!=='GET'){
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return Response.json({error:'허용되지 않은 요청 출처입니다.'},{status:403});
 }
 if(path==='/api/me')return Response.json({user});
 if(path==='/api/status'){const sources=await sourceStates();return Response.json({ready:sources.length===2,job:await jobStatus(),sources});}
 if(path==='/api/prices'&&request.method==='GET')return Response.json(await listing(user,url));
 if(path==='/api/favorite'&&request.method==='POST'){
  if(user.service)return Response.json({error:'로그인이 필요합니다.'},{status:401});const body:any=await request.json();if(!['ekcm','ilpoom'].includes(body.source)||typeof body.id!=='string'||body.id.length>100)throw new Error('상품을 확인하세요.');
  if(body.saved)await database().prepare('INSERT OR IGNORE INTO favorites(user_id,source,product_id) VALUES(?,?,?)').bind(user.id,body.source,body.id).run();else await database().prepare('DELETE FROM favorites WHERE user_id=? AND source=? AND product_id=?').bind(user.id,body.source,body.id).run();return Response.json({ok:true});
 }
 if(user.role!=='admin')return Response.json({error:'관리자만 사용할 수 있습니다.'},{status:403});
 if(path==='/api/bootstrap'&&request.method==='POST')return Response.json(await bootstrap());
 if(path==='/api/refresh'&&request.method==='POST')return Response.json(await start());
 if(path==='/api/refresh/step'&&request.method==='POST'){const body:any=await request.json();if(typeof body.id!=='string'||body.id.length>100)throw new Error('수집 작업을 확인하세요.');return Response.json(await step(body.id));}
 return Response.json({error:'요청을 찾을 수 없습니다.'},{status:404});
 }catch(e:any){return Response.json({error:e.message||'서버 처리 오류'},{status:500});}}
async function handle(request:Request){
 const user=await identity(request),response=await respond(request,user);
 response.headers.set('Cache-Control','private, no-store');
 if(user.guest&&user.newVisitor)response.headers.append('Set-Cookie',`price_visitor=${user.visitor}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
 return response;
}
export {handle as GET,handle as POST};
