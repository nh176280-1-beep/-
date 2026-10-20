export const PARTS=['등심','꽃등심','윗등심','아랫등심','안심','채끝','목심','앞다리','양지','사태','갈비','갈비살','갈비본살','부채살','치마살','업진살','안창살','차돌박이','토시살','꾸리살','홍두깨','제비추리','우둔','설도','삼겹살','목살'];
export const PART_ALIAS={'아래등심':'아랫등심','알목심':'목심','갈비살(늑간)':'갈비살'};
const longest=[...PARTS,...Object.keys(PART_ALIAS)].sort((a,b)=>b.length-a.length);
export function canonicalPart(value){const x=String(value||'').trim();return PART_ALIAS[x]||x;}
export function partFromName(value){const x=longest.find(p=>String(value).includes(p));return x?canonicalPart(x):'';}
export function categoryMatches(category,part){const x=canonicalPart(category);return x===part||(part==='등심'&&['꽃등심','윗등심','아랫등심'].includes(x));}
export function normalizedGrade(value){return String(value||'').trim().replace(/등급/g,'').replace(/\([0-9]+\)/g,'').trim();}
export function describe(item){
 const text=[item.classificationText,item.name].filter(Boolean).join(' ');
 const cold=/냉장/.test(text),frozen=/냉동/.test(text);
 const storage=item.storage||(cold&&!frozen?'냉장':frozen&&!cold?'냉동':'');
 const species=item.species||(/한우/.test(text)?'한우':/육우/.test(text)?'육우':/수입우|수입산/.test(text)?'수입우':/돼지|돈육|한돈/.test(text)?'돼지':'');
 const part=item.part?canonicalPart(item.part):partFromName(text);
 const gender=item.gender||(/거세/.test(text)?'거세':/암소/.test(text)?'암소':/수소/.test(text)?'수소':'');
 return {...item,part,storage,species,gender,gradeGroup:normalizedGrade(item.grade)};
}
export function criteria(input={}){
 const choose=(v,allowed)=>allowed.includes(v)?v:'';
 const explicit={q:String(input.q||'').trim().slice(0,80),part:choose(canonicalPart(input.part),PARTS),grade:choose(input.grade,['1++','1+','1','2','3']),storage:choose(input.storage,['냉장','냉동']),species:choose(input.species||'한우',['한우','육우','수입우','돼지']),gender:choose(input.gender||'거세',['거세','암소','전체']),format:'원료육',page:1};
 for(const k of ['grade','storage','species','gender'])if(input[k]&&!explicit[k])throw Error('지원하지 않는 조건: '+k);
 if(!explicit.part)throw Error('원본 분류를 조회할 부위를 선택하세요.');
 if(!explicit.species)throw Error('축종을 선택하세요.');
 if(input.format&&input.format!=='원료육')throw Error('현재 비교는 원료육 카테고리만 지원합니다.');
 return explicit;
}
export function matches(item,c){
 const x=describe(item);
 return (!c.part||categoryMatches(x.part,c.part))&&(!c.grade||x.gradeGroup===c.grade)&&(!c.storage||x.storage===c.storage)&&(!c.species||x.species===c.species)&&(!c.gender||c.gender==='전체'||x.gender===c.gender||c.species==='돼지'||c.species==='수입우')&&(!c.q||c.q.toLowerCase().split(/\s+/).every(word=>[x.name,x.classificationText,x.grade].join(' ').toLowerCase().includes(word)));
}
export function comparableGroups(items){
 const groups=new Map();
 for(const row of items){const x=describe(row);if(x.unit!=='1kg'||x.availability==='품절')continue;
  // Old name-inferred snapshots and incomplete classifications are never price-comparison evidence.
  const complete=x.categoryVerified===true&&x.format==='원료육'&&!!(x.species&&x.part&&x.grade&&x.storage&&x.gender);
  if(!complete)continue;
  const fields=[x.species,x.part,x.grade,x.storage,x.gender,x.format],key=fields.join('|');let group=groups.get(key);
  if(!group){group={key,label:fields.join(' · '),complete:true,sources:{},comparable:false};groups.set(key,group);}
  const s=group.sources[x.sourceId]||{count:0,sum:0,min:x.price,max:x.price};s.count++;s.sum+=x.price;s.average=Math.round(s.sum/s.count);s.min=Math.min(s.min,x.price);s.max=Math.max(s.max,x.price);group.sources[x.sourceId]=s;
  group.comparable=!!(group.sources.ekcm&&group.sources.ilpoom);
 }
 return [...groups.values()];
}
