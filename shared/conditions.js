export const PARTS=['등심','꽃등심','윗등심','아랫등심','안심','채끝','목심','앞다리','양지','사태','갈비','갈비살','갈비본살','부채살','치마살','업진살','안창살','차돌박이','토시살','꾸리살','홍두깨','제비추리','우둔','설도'];
const longest=[...PARTS].sort((a,b)=>b.length-a.length);
export function normalizedGrade(value){return String(value||'').trim().replace(/등급/g,'').replace(/\([0-9]+\)/g,'').trim();}
export function describe(item){
 const text=[item.classificationText,item.name].filter(Boolean).join(' ');
 const cold=/냉장/.test(text),frozen=/냉동/.test(text);
 const storage=item.storage||(cold&&!frozen?'냉장':frozen&&!cold?'냉동':'');
 const species=item.species||(/한우/.test(text)?'한우':/육우/.test(text)?'육우':/수입우|수입산/.test(text)?'수입우':/돼지|돈육|한돈/.test(text)?'돼지':'');
 const part=item.part||longest.find(p=>text.includes(p))||'';
 const gender=item.gender||(/거세/.test(text)?'거세':/암소/.test(text)?'암소':/수소/.test(text)?'수소':'');
 return {...item,part,storage,species,gender,gradeGroup:normalizedGrade(item.grade)};
}
export function criteria(input={}){
 const q=String(input.q||'').trim().slice(0,80);
 const choose=(v,allowed)=>allowed.includes(v)?v:'';
 const explicit={q,part:choose(input.part,PARTS),grade:choose(input.grade,['1++','1+','1','2','3']),storage:choose(input.storage,['냉장','냉동']),species:choose(input.species,['한우','육우','수입우','돼지']),page:Math.min(40,Math.max(1,Number(input.page)||1))};
 if(!Number.isInteger(explicit.page))throw Error('페이지는 정수여야 합니다.');
 if(!q&&!explicit.part)throw Error('검색어 또는 부위를 선택하세요.');
 return explicit;
}
export function matches(item,c){
 const x=describe(item);
 return (!c.part||x.part===c.part)&&(!c.grade||x.gradeGroup===c.grade)&&(!c.storage||x.storage===c.storage)&&(!c.species||x.species===c.species)&&(!c.q||c.q.toLowerCase().split(/\s+/).every(word=>[x.name,x.classificationText,x.grade].join(' ').toLowerCase().includes(word)));
}
export function comparableGroups(items){
 const groups=new Map();
 for(const row of items){const x=describe(row);if(x.unit!=='1kg'||x.availability==='품절')continue;
  const fields=[x.species,x.part,x.grade||x.gradeGroup,x.storage,x.gender];
  const key=fields.join('|');let group=groups.get(key);
  if(!group){group={key,label:fields.map(x=>x||'미표기').join(' · '),complete:fields.every(Boolean),sources:{}};groups.set(key,group);}
  const s=group.sources[x.sourceId]||{count:0,min:x.price,max:x.price};s.count++;s.min=Math.min(s.min,x.price);s.max=Math.max(s.max,x.price);group.sources[x.sourceId]=s;
 }
 return [...groups.values()];
}
