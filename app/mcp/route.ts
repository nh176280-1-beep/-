import {identity,bootstrap,sourceStates} from '../../lib/data';
import {start,step,jobStatus} from '../../lib/collect';
export const dynamic='force-dynamic';
const tools=[
 {name:'price_status',description:'가격 저장소의 실제 수집 건수와 진행 중 작업을 확인합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'prepare_prices',description:'검증된 실제 가격 60,250건을 영구 저장소에 초기 적재합니다. ready가 true가 될 때까지 반복합니다. 기존 갱신 데이터를 덮어쓰지 않습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'start_price_refresh',description:'금천미트 공개 API 전체 카테고리와 일품한우 전체 공개 목록의 가격 갱신을 시작하거나 기존 작업을 이어갑니다.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'continue_price_refresh',description:'가격 갱신을 최대 40페이지 (4개 병렬) 이어서 수행하고 영구 저장합니다. 반환 status가 done 또는 error가 될 때까지 같은 id로 반복합니다. 브라우저가 닫혀 있어도 호출할 수 있습니다.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}
];
export async function POST(request:Request){let body:any;try{
 body=await request.json();const id=body.id??null;let result:any;
 if(body.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
 else if(body.method==='initialize')result={protocolVersion:'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'한눈에 시세',version:'1.0.0'}};
 else if(body.method==='notifications/initialized')return new Response(null,{status:202});
 else if(body.method==='tools/list')result={tools};
 else if(body.method==='tools/call'){
  const user=await identity();if(user.role!=='admin'&&body.params.name!=='price_status')throw new Error('관리자만 가격을 갱신할 수 있습니다.');
  let value:any;switch(body.params.name){case 'price_status':value={sources:await sourceStates(),job:await jobStatus()};break;case 'prepare_prices':value=await bootstrap();break;case 'start_price_refresh':value=await start();break;case 'continue_price_refresh':{const job=body.params.arguments?.id;if(typeof job!=='string'||job.length>100)throw new Error('수집 작업 ID를 확인하세요.');value=await step(job);break;}default:throw new Error('지원하지 않는 도구입니다.');}
  result={content:[{type:'text',text:JSON.stringify(value)}]};
 }else return Response.json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
 return Response.json({jsonrpc:'2.0',id,result});
 }catch(e:any){return Response.json({jsonrpc:'2.0',id:body?.id??null,result:{isError:true,content:[{type:'text',text:e.message}]}});}}
