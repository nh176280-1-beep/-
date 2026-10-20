import {searchSource,detailSource} from '../shared/live-source.js';
import {criteria,comparableGroups} from '../shared/conditions.js';
import {writeFileSync} from 'node:fs';
const c=criteria({q:process.argv[2]||'',species:'한우',gender:'거세',part:'등심',grade:'1+',storage:'냉장'});
let failed=false;const report={criteria:c,sources:[],at:new Date().toISOString()};
await Promise.all(['ekcm','ilpoom'].map(async source=>{
 const started=Date.now();
 try{const result=await searchSource(source,c);
  const entry={source,status:result.status,checkedAt:result.checkedAt,sourceTotal:result.sourceTotal,rawCount:result.rawCount,matching:result.items.length,complete:result.complete,groups:comparableGroups(result.items),goodsNos:result.items.map(i=>i.goodsNo),milliseconds:Date.now()-started};report.sources.push(entry);console.log(JSON.stringify(entry));
  if(source==='ilpoom'&&result.items[0]){const d=await detailSource(source,result.items[0].goodsNo);console.log(JSON.stringify({source,goodsNo:d.goodsNo,productionDate:d.productionDate||null,expiryDate:d.expiryDate||null,checkedAt:d.checkedAt}));}
 }catch(e){failed=true;console.error(JSON.stringify({source,error:e.message}));}
}));if(process.env.SOURCE_REPORT_PATH)writeFileSync(process.env.SOURCE_REPORT_PATH,JSON.stringify(report,null,2));if(failed)process.exitCode=1;
