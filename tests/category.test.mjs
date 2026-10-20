import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchSource} from '../shared/category-source.js';
import {criteria,describe,comparableGroups} from '../shared/conditions.js';
const read=file=>readFileSync(new URL('./fixtures/'+file,import.meta.url),'utf8');
const cats=JSON.parse(read('ekcm-categories.json')),rows=JSON.parse(read('ekcm-raw-material.json')),html=read('ilpoom-sirloin-1plus.html');
let pageSize=250,wrongLeaf=false,failList=false,calls=[];
const fetcher=async(value,options={})=>{
 const url=new URL(value);calls.push({url,options});
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /');
 if(url.pathname.endsWith('/getDispCtgList'))return Response.json(cats);
 if(url.pathname.endsWith('/dispGoodsList')){
  const body=JSON.parse(options.body);assert.equal(options.method,'POST');assert.deepEqual(body.strgMthdGbCdList,['1']);assert.deepEqual(body.lsprdGrdCdList,['B']);assert(!('searchWord' in body));assert(body.dispCtgNoList.every(id=>cats.some(c=>c.dispCtgNo===id&&c.dispCtgNm==='등심')));
  const offset=(body.pageNo-1)*pageSize;const data=rows.slice(offset,offset+pageSize).map(x=>wrongLeaf?{...x,leafCtgNo:'retail-small-pack'}:x);
  return Response.json({code:'0000',payload:data});
 }
 if(url.pathname.endsWith('search_classification')){
  const code=url.searchParams.get('category_code');
  return Response.json({category_child:code==='c0008'?[{category_code:'00080002',category_name:'등심',cnt:66}]:[{category_code:'000800020004',category_name:'1+등급',cnt:66}]});
 }
 if(url.pathname.endsWith('search_list')){
  assert.equal(url.searchParams.get('searchMode'),'catalog');assert.equal(url.searchParams.get('category'),'c000800020004');
  if(failList)return new Response('temporary server failure',{status:500});return new Response(html,{status:200});
 }
 throw Error('Unexpected URL '+url);
};
const c=criteria({species:'한우',gender:'거세',part:'등심',grade:'1+',storage:'냉장'});
let a=await searchSource('ekcm',c,fetcher),b=await searchSource('ilpoom',c,fetcher);
assert.equal(a.items.length,113);assert.equal(a.complete,true);assert.deepEqual(new Set(a.items.map(x=>x.goodsNo)),new Set(rows.map(x=>String(x.goodsNo))));
assert(a.items.some(x=>!x.name.includes('냉장')));assert(a.items.every(x=>!x.name.includes('소포장')));assert(a.items.every(x=>x.storage==='냉장'&&x.grade==='1+'&&x.format==='원료육'));
assert.equal(Math.min(...a.items.map(x=>x.price)),67500);assert.equal(Math.max(...a.items.map(x=>x.price)),88800);
assert.equal(b.items.length,66);const groups=comparableGroups([...a.items,...b.items]);assert.equal(groups.length,4);assert(groups.every(g=>!g.comparable));assert.deepEqual(new Set(b.items.map(x=>x.part)),new Set(['꽃등심','아랫등심','윗등심']));
assert.equal(b.items.filter(x=>x.part==='아랫등심').length,19);
const lower=await searchSource('ilpoom',criteria({...c,part:'아래등심'}),fetcher);assert.equal(lower.items.length,19);assert(lower.items.every(x=>x.part==='아랫등심'));
assert.equal(describe({name:'한우아래등심/거세/1+[냉장]'}).part,'아랫등심');
assert.equal(comparableGroups([{...a.items[0],categoryVerified:false}]).length,0);assert.equal(comparableGroups([{...a.items[0],format:'소포장'}]).length,0);
// Continue even when the source caps returned pages below the requested pageSize.
pageSize=50;a=await searchSource('ekcm',c,fetcher);assert.equal(a.items.length,113);
wrongLeaf=true;await assert.rejects(()=>searchSource('ekcm',c,fetcher),/카테고리 밖/);wrongLeaf=false;
failList=true;await assert.rejects(()=>searchSource('ilpoom',c,fetcher),/HTTP 500/);
console.log('PASS: exact 113 original goods IDs, no cold-name dependency, original API grade/storage, retail exclusion, complete capped pagination, 66 sirloin subparts, lower-sirloin alias, no cross-part comparison, unverified exclusion, HTTP 500 rejection');
