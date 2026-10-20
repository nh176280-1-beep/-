import {searchSource,detailSource} from '../shared/live-source.js';
import {criteria} from '../shared/conditions.js';
const c=criteria({q:process.argv[2]||'',species:'한우',part:'등심',grade:'1+',storage:'냉장',page:1});
let failed=false;
await Promise.all(['ekcm','ilpoom'].map(async source=>{
 const started=Date.now();
 try{const result=await searchSource(source,c);console.log(JSON.stringify({source,status:result.status,checkedAt:result.checkedAt,sourceTotal:result.sourceTotal,matching:result.items.length,hasMore:result.hasMore,milliseconds:Date.now()-started}));
  if(source==='ilpoom'&&result.items[0]){const detail=await detailSource(source,result.items[0].goodsNo);console.log(JSON.stringify({source,goodsNo:detail.goodsNo,productionDate:detail.productionDate||null,expiryDate:detail.expiryDate||null,checkedAt:detail.checkedAt}));}
 }catch(e){failed=true;console.error(JSON.stringify({source,error:e.message}));}
}));if(failed)process.exitCode=1;
