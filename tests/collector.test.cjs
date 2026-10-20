const {readFileSync}=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let source=readFileSync('lib/collect.ts','utf8').replace(/^import .*;$/gm,'');
source=source.slice(0,source.indexOf('export async function jobStatus'))+'\nglobalThis.advance=advance;';
source=source.replace(/async function api\([\s\S]*?(?=async function robots)/,'async function api(...args:any[]){return mock.api(...args)}\n');
source=source.replace(/async function mark\([\s\S]*?(?=async function advance)/,`async function mark(...args:any[]){return mock.mark(...args)}
async function count(...args:any[]){return mock.count(...args)}
async function activate(...args:any[]){return mock.activate(...args)}\n`);
(async()=>{
 let inflight=0,peak=0,seen=new Set(),calls=[],fail=false;
 const mock={async api(filter,offset,sort){inflight++;peak=Math.max(peak,inflight);calls.push(offset);await new Promise(r=>setTimeout(r,5));inflight--;if(fail&&offset===500)throw Error('HTTP 503');return {totalCount:1500,searchDataList:Array.from({length:250},(_,i)=>({goodsNo:String(offset+i)}))};},async mark(job,shard,ids){ids.forEach(id=>seen.add(id))},async count(){return seen.size},async activate(){}};
 const context={SOURCES:[{id:'ekcm'},{id:'ilpoom',home:'https://example.test'}],load:require('cheerio/slim').load,robotsParser:()=>({isAllowed:()=>true}),parsePrices:()=>[],fetchPage:async url=>{const page=Number(new URL(url).searchParams.get('page'));const start=(page-1)*200;const size=Math.min(200,Math.max(0,850-start));return {url,html:`<script>$('.total').html('850')</script>`+Array.from({length:size},(_,i)=>`<li class='goods_list_style1'><div class='goods_name_area'><a href='/goods/view?no=${start+i}'>상품</a></div></li>`).join('')}},mock,console,URL,URLSearchParams,Date,JSON,Number,Math,Set,Promise,source:()=>({}),parseEkcmPrices:()=>[]};vm.createContext(context);vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 const job={id:'test',state:{phase:'ekcm',init:true,index:0,from:0,sort:'desc',total:0,expected:1500,shards:['category'],pages:0}};
 await context.advance(job);assert.equal(job.state.from,250);assert.equal(seen.size,250);
 calls=[];await context.advance(job);assert.equal(peak,4);assert.deepEqual(calls,[250,500,750,1000]);assert.equal(seen.size,1250);assert.equal(job.state.from,1250);
 await context.advance(job);assert.equal(seen.size,1500);assert.equal(job.state.index,1);
 // A failed parallel batch must leave its checkpoint and stored records untouched.
 seen=new Set();calls=[];fail=true;job.state={phase:'ekcm',init:true,index:0,from:250,sort:'desc',total:1500,expected:1500,shards:['category'],pages:1};
 await assert.rejects(()=>context.advance(job),/503/);assert.equal(job.state.from,250);assert.equal(job.state.pages,1);assert.equal(seen.size,0);assert.equal(inflight,0);
 fail=false;await context.advance(job);assert.equal(job.state.from,1250);assert.equal(seen.size,1000);
 seen=new Set();job.state={phase:'ilpoom',init:true,categories:['c1'],index:0,page:1,total:0,expected:0,missing:0,pages:0,robots:''};
 await context.advance(job);assert.equal(job.state.page,2);assert.equal(seen.size,200);
 await context.advance(job);assert.equal(seen.size,850);assert.equal(job.state.index,1);assert.equal(job.state.missing,0);assert.equal(job.state.expected,850);
 console.log('PASS: four concurrent fetches, exact final-page boundary, complete pagination, failed-batch checkpoint, safe retry');
})().catch(e=>{console.error(e);process.exitCode=1});
