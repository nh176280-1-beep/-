'use client';
import {useEffect,useState,useRef} from 'react';
import {PARTS,comparableGroups} from '../shared/conditions';
const money=(n:number)=>Number(n).toLocaleString('ko-KR');
const when=(s?:string)=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'확인 정보 없음';
const keyOf=(item:any)=>item.sourceId+':'+item.id;
const detailValue=(detail:any,field:string)=>!detail?'상세 확인 전':detail.error?'상세 조회 실패':detail[field]||'원본 정보 없음';
const statusName:any={unsupported:'판매처 지원 대상 아님',live:'원본 조회 성공',cached:'최근 확인 결과',stale:'마지막 성공 사본',snapshot:'저장 목록 대체',error:'원본 조회 실패'};
async function api(path:string,body?:any){
 const response=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const data:any=await response.json();if(!response.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');return data;
}
export default function Board(){
 const [user,setUser]=useState<any>(null),[mode,setMode]=useState('live'),[source,setSource]=useState('all');
 const [q,setQ]=useState(''),[part,setPart]=useState('등심'),[grade,setGrade]=useState('1+'),[storage,setStorage]=useState('냉장'),[species,setSpecies]=useState('한우'),[gender,setGender]=useState('거세');
 const [result,setResult]=useState<any>(null),[saved,setSaved]=useState<any>(null),[page,setPage]=useState(1),[livePage,setLivePage]=useState(1);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[setup,setSetup]=useState(''),[jobs,setJobs]=useState<any[]>([]),[collecting,setCollecting]=useState<string[]>([]);
 const [selected,setSelected]=useState<any[]>([]),[details,setDetails]=useState<Record<string,any>>({}),[detailBusy,setDetailBusy]=useState(false),[audit,setAudit]=useState<any[]|null>(null);
 const searchVersion=useRef(0),savedVersion=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;(async()=>{try{
  const me=await api('/api/me');if(mounted.current)setUser(me.user);
  const state=await api('/api/status');if(mounted.current)setJobs(state.jobs||[]);
  if(!state.ready){if(me.user.role!=='admin'){setSetup('저장 목록 준비가 필요합니다. 관리자에게 문의하세요. 조건별 원본 조회는 사용할 수 있습니다.');return;}
   let b;do{b=await api('/api/bootstrap',{});if(!mounted.current)return;setSetup(`저장 가격 준비 ${b.importedChunks}/${b.totalChunks}`);}while(!b.ready);setSetup('');}
 }catch(e:any){if(mounted.current)setError(e.message);}})();return()=>{mounted.current=false;};},[]);
 const criteria=(p=1)=>({q,part,grade,storage,species,gender,format:'원료육',page:1});
 async function search(p=1){
  const version=++searchVersion.current;setBusy(true);setError('');setSelected([]);
  try{const next=await api('/api/live',criteria(p));if(version===searchVersion.current){setResult(next);setLivePage(p);}}
  catch(e:any){if(version===searchVersion.current)setError(e.message);}
  finally{if(version===searchVersion.current)setBusy(false);}
 }
 async function loadSaved(p=page){
  const version=++savedVersion.current;
  try{const params=new URLSearchParams({q,source,page:String(p),favorites:mode==='favorites'?'1':'0'});const next=await api('/api/prices?'+params);if(version===savedVersion.current)setSaved(next);}
  catch(e:any){setError(e.message);}
 }
 // Stored browsing is independent of the live-search form, and never triggers a full collection.
 useEffect(()=>{if(mode==='live')return;const timer=setTimeout(()=>loadSaved(page),300);return()=>clearTimeout(timer);},[mode,source,q,page]);
 useEffect(()=>{const timer=setInterval(async()=>{try{const state=await api('/api/status');setJobs(state.jobs||[]);}catch{}},60000);return()=>clearInterval(timer);},[]);
 function changeMode(next:string){setMode(next);setPage(1);setSelected([]);setError('');setAudit(null);}
 async function collect(id:string){
  setCollecting(x=>[...x,id]);setError('');
  try{let job=await api('/api/refresh',{source:id});setJobs(x=>[...x.filter(j=>j.id!==job.id),job]);
   while(job?.status==='running'){job=await api('/api/refresh/step',{id:job.id});if(!mounted.current)return;setJobs(x=>[...x.filter(j=>j.id!==job.id),job]);}
   if(job?.status==='error')setError(job.error||'수집을 완료하지 못했습니다. 기존 저장 가격을 유지합니다.');if(mode!=='live')await loadSaved();
  }catch(e:any){setError(e.message);}finally{setCollecting(x=>x.filter(s=>s!==id));}
 }
 async function favorite(item:any){try{
  await api('/api/favorite',{source:item.sourceId,id:item.id,saved:!item.favorite});
  if(mode==='live')setResult((r:any)=>r?{...r,items:r.items.map((i:any)=>keyOf(i)===keyOf(item)?{...i,favorite:!item.favorite}:i)}:r);else await loadSaved();
 }catch(e:any){setError(e.message);}}
 function select(item:any){if(!item.categoryVerified||!comparableGroups([item]).length){setError('원본 분류가 확인되지 않은 저장 자료는 비교할 수 없습니다. 최신 원료육 조회에서 선택하세요.');return;}setSelected(rows=>rows.some(x=>keyOf(x)===keyOf(item))?rows.filter(x=>keyOf(x)!==keyOf(item)):rows.length<4?[...rows,item]:rows);}
 async function checkDetails(){setDetailBusy(true);setError('');
  await Promise.all(selected.map(async item=>{
   const goodsNo=item.goodsNo||new URL(item.url).searchParams.get(item.sourceId==='ekcm'?'goodsNo':'no');
   try{const next=await api('/api/detail',{source:item.sourceId,goodsNo});setDetails(old=>({...old,[keyOf(item)]:next}));}
   catch(e:any){setDetails(old=>({...old,[keyOf(item)]:{error:e.message}}));}
  }));setDetailBusy(false);
 }
 const rawItems=mode==='live'?(result?.items||[]):(saved?.items||[]);
 const items=rawItems.filter((i:any)=>source==='all'||i.sourceId===source);
 const groups=mode==='live'?(result?.groups||[]):comparableGroups(items);
 const sources=mode==='live'?(result?.sources||[]):(saved?.sources||[]);
 const changeCondition=(setter:(v:any)=>void)=>(event:any)=>{setter(event.target.value);};
 return <><header><div className="brand"><b className="logo">시</b><div><strong>한눈에 시세</strong><small>대구축협 육가공공장</small></div></div><div className="account"><span>{user?.name||'공개 가격 조회'}</span><a target="_top" href={user?.guest?'/signin-with-chatgpt?return_to=%2F':'/signout-with-chatgpt?return_to=%2F'}>{user?.guest?'관리자 로그인':'로그아웃'}</a></div></header>
 <div className="workspace"><aside><p>PRICE WORKSPACE</p>{[['live','⇄ 최신 가격 비교'],['saved','▦ 저장 전체 목록'],['favorites','☆ 관심 품목']].map(([id,name])=><button key={id} className={mode===id?'selected':''} onClick={()=>changeMode(id)}>{name}</button>)}<div className="note">● 확인 시각을 보세요<small>조회 시점의 공개 가격입니다.<br/>주문 전 원본을 확인하세요.</small></div></aside>
 <main><section className="heading"><div><p>RAW MEAT PRICE COMPARISON · v3</p><h1>{mode==='live'?'조건별 최신 가격 비교':mode==='favorites'?'자주 찾는 관심 품목':'저장된 전체 가격'}<i>.</i></h1><span>{mode==='live'?'원료육 카테고리 전체를 확인하고 같은 세부 부위끼리 비교하세요.':'저장 시점의 가격입니다. 최신 확인은 ‘최신 가격 비교’를 이용하세요.'}</span></div></section>
 {error&&<div role="alert" className="warning">{error}</div>}{setup&&<div className="notice">{setup}</div>}
 {mode==='live'?<form className="filter-panel" onSubmit={e=>{e.preventDefault();search(1);}}>
  <label>축종<select aria-label="축종" value={species} onChange={changeCondition(setSpecies)}>{['한우','육우','수입우','돼지'].map(v=><option key={v} value={v}>{v||'전체'}</option>)}</select></label>
  <label>성별<select aria-label="성별" value={gender} onChange={changeCondition(setGender)}>{['거세','암소','전체'].map(v=><option key={v}>{v}</option>)}</select></label>
  <label>부위<select aria-label="부위" value={part} onChange={changeCondition(setPart)}>{PARTS.map(v=><option key={v}>{v}</option>)}</select></label>
  <label>등급<select aria-label="등급" value={grade} onChange={changeCondition(setGrade)}>{['','1++','1+','1','2','3'].map(v=><option key={v} value={v}>{v||'전체'}</option>)}</select></label>
  <label>보관<select aria-label="보관 상태" value={storage} onChange={changeCondition(setStorage)}>{['','냉장','냉동'].map(v=><option key={v} value={v}>{v||'전체'}</option>)}</select></label>
  <label className="query-label">추가 검색어<input aria-label="추가 검색어" value={q} onChange={e=>setQ(e.target.value)} placeholder="브랜드·상품명 등" maxLength={80}/></label>
  <button className="primary" disabled={busy||!user}>{busy?'두 판매처 확인 중…':'최신 가격 확인'}</button>
 </form>:<label className="search stored-search">⌕ <input aria-label="저장 품목 검색" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="저장된 전체 품목 검색"/></label>}
 {mode==='live'&&<p className="explanation">조회 시 원본을 확인합니다. 같은 조건은 15초 동안 확인 결과를 재사용합니다. 실패하면 마지막 성공 사본 또는 저장 목록임을 표시합니다. 선택한 원료육 카테고리의 전체 페이지를 검증합니다. 소포장 상품은 포함하지 않습니다. ‘등심’ 조회는 세부 부위를 나눠 표시합니다.</p>}
 {mode==='live'&&result&&<p className="query-caption">검증 요청 조건: {Object.entries(result.criteria).filter(([k,v])=>k!=='page'&&v).map(([,v])=>String(v)).join(' · ')} / 원료육 전체 페이지 검증{busy?' · 새 조건 조회 중':''}</p>}
 <section className="source-grid">{sources.map((s:any)=><article key={s.sourceId||s.id} className="source-card"><div className="avatar">{(s.sourceId||s.id)==='ekcm'?'E':'일'}</div><div><strong>{s.name}</strong><small>{mode==='live'?`${money(s.items.length)}개 조건 일치 · 원본 분류 ${s.sourceTotal===null?'확인 불가':money(s.sourceTotal)}개`:`${money(s.count)}개 저장 가격`}</small><small>확인 {when(s.checkedAt||s.checked_at)}</small><small>{s.error||s.message||s.scope}</small></div><span className={['live','cached','ok'].includes(s.status)?'ok':'partial'}>{statusName[s.status]||(s.status==='ok'?'저장 완료':'일부 저장')}</span></article>)}</section>
 {groups.length>0&&<section className="comparison"><h2>판매처별 가격 범위 <small>선택 분류 검증 결과 · 원/kg · 품절 제외</small></h2><div className="table-scroll"><table><thead><tr><th>축종 · 세부 부위 · 등급 · 보관 · 성별 · 형태</th><th>금천미트</th><th>일품한우</th></tr></thead><tbody>{groups.map((g:any)=><tr key={g.key}><td>{g.label}{!g.comparable&&<small>일치하는 상대 판매처 부위 없음 · 직접 비교 불가</small>}{!g.complete&&<small>조건 미확인 · 비교 제외</small>}</td>{['ekcm','ilpoom'].map(id=><td key={id}>{g.sources[id]?<>{money(g.sources[id].min)} ~ {money(g.sources[id].max)}<small>평균 {money(g.sources[id].average)}원</small><small>{g.sources[id].count}개 상품</small></>:'해당 결과 없음'}</td>)}</tr>)}</tbody></table></div><p className="explanation">같은 축종·성별·세부 부위·등급·보관·원료육끼리만 묶습니다. 다른 세부 부위는 합치지 않습니다. 한 판매처만 있으면 가격 우열을 판단하지 않습니다. 브랜드·생산일 차이는 별도로 확인하세요.</p></section>}
 <section className="toolbar"><div className="tabs">{[['all','전체'],['ekcm','금천미트'],['ilpoom','일품한우']].map(([id,name])=><button key={id} className={source===id?'selected':''} onClick={()=>{setSource(id);setPage(1);}}>{name}</button>)}</div><span>상품 선택 최대 4개 · 생산일 비교</span></section>
 {selected.length>0&&<section className="comparison"><div className="compare-heading"><h2>선택 상품 정보 ({selected.length}/4)</h2><button disabled={detailBusy} onClick={checkDetails}>{detailBusy?'상세 확인 중…':'생산일·유통기한 확인'}</button><button onClick={()=>setSelected([])}>선택 해제</button></div><div className="table-scroll"><table><thead><tr><th>항목</th>{selected.map(item=><th key={keyOf(item)}>{item.sourceName}<small>{item.name}</small></th>)}</tr></thead><tbody>{[
  ['분류',(i:any)=>[i.species,i.gender,i.part,i.grade,i.storage,i.format].join(' · ')],['단가',(i:any)=>money(i.price)+'원 / '+i.unit],['등급 · 보관',(i:any)=>(i.grade||'미표기')+' · '+(i.storage||'미표기')],['상품 중량 / 총액',(i:any)=>(i.lotWeight||'미표기')+' / '+(i.totalPrice?money(i.totalPrice)+'원':'미표기')],['가격 확인',(i:any)=>when(i.checkedAt||saved?.sources?.find((s:any)=>s.id===i.sourceId)?.checked_at)],
  ['생산일',(i:any)=>i.productionDate||detailValue(details[keyOf(i)],'productionDate')],['유통·소비기한',(i:any)=>i.expiryDate||detailValue(details[keyOf(i)],'expiryDate')],['원산지',(i:any)=>i.origin||detailValue(details[keyOf(i)],'origin')],['상세 상태',(i:any)=>{const d=details[keyOf(i)];return d?d.error||`${statusName[d.status]||'확인'} · ${when(d.checkedAt)}`:'미확인';}]
 ].map(([label,value]:any)=><tr key={label}><th>{label}</th>{selected.map(i=><td key={keyOf(i)}>{value(i)}</td>)}</tr>)}</tbody></table></div><p className="explanation">분류 조건이 다른 선택 상품은 가격 우열을 판단할 수 없습니다. 상세 조회는 선택 상품만 요청하며 원본에 없는 날짜는 추정하지 않습니다. 상세 확인 시각은 가격 갱신 시각과 별개입니다.</p></section>}
 <div className="list-heading"><p>가격 목록 <strong>{money(mode==='live'?items.length:saved?.total||0)}</strong></p><span>{mode==='live'?'원료육 카테고리 조건 일치 상품':'한 페이지 100개'}</span></div>
 <section className="price-grid">{items.map((item:any)=><article className="price-card" key={keyOf(item)}><div className="card-top"><span>{item.sourceName}</span><button aria-label={item.name+' 관심 품목 '+(item.favorite?'해제':'추가')} onClick={()=>favorite(item)}>{item.favorite?'★':'☆'}</button></div><h2>{item.name}</h2><div className="tags">{[item.grade||'등급 미표기',item.storage||'보관 미표기',item.gender||'성별 미표기',item.part||'부위 미확인',item.format||'형태 미확인',item.unit,item.availability].filter(Boolean).map((v:string,i:number)=><span key={i}>{v}</span>)}</div><p className="price">{money(item.price)}<small>원 / {item.unit}</small></p><small>{item.lotWeight?'중량 '+item.lotWeight:''}{item.totalPrice?' · 총 '+money(item.totalPrice)+'원':''}</small><small>가격 확인 {when(item.checkedAt||saved?.sources?.find((s:any)=>s.id===item.sourceId)?.checked_at)}</small><small>{item.gradeBasis||'원본 등급 표기'} · {item.categoryVerified?'원본 카테고리 검증':'이전 이름 기반 자료 · 비교 제외'}</small><button className="select-item" aria-pressed={selected.some(x=>keyOf(x)===keyOf(item))} onClick={()=>select(item)}>{selected.some(x=>keyOf(x)===keyOf(item))?'✓ 비교 선택됨':'비교에 담기'}</button><small>상품번호 {item.goodsNo||'원본 링크 확인'}{item.productionDate?' · 생산 '+item.productionDate:''}{item.expiryDate?' · 기한 '+item.expiryDate:''}</small><small>{item.categoryPath||'원본 분류 미확인'}</small><a href={item.url} target="_blank" rel="noreferrer">원본 상품 확인 ↗</a></article>)}</section>
 {!busy&&items.length===0&&<div className="empty">{mode==='live'&&!result?'조건을 선택한 뒤 ‘최신 가격 확인’을 누르세요.':'현재 페이지에 조건이 맞는 가격이 없습니다.'}</div>}
 {mode==='live'&&result?<p className="explanation">카테고리 검증에 성공한 판매처 결과만 표시합니다. 검색 조건을 바꾸면 다시 조회하세요.</p>:mode!=='live'&&<nav className="pagination"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page} / {saved?.pageCount||1} 페이지</span><button disabled={!saved||page>=saved.pageCount} onClick={()=>setPage(p=>p+1)}>다음</button></nav>}

 {user?.role==='admin'&&<section className="admin-panel"><h2>저장 목록 관리</h2><p>원본 조회와 별개인 전체 목록 갱신입니다. 판매처별로 독립 실행합니다. 화면을 닫으면 후속 요청이 멈추며 다시 실행해 이어갈 수 있습니다.</p><div className="actions">{[['ekcm','금천미트'],['ilpoom','일품한우']].map(([id,name])=><button key={id} disabled={collecting.includes(id)} onClick={()=>collect(id)}>{collecting.includes(id)?name+' 수집 중…':name+' 전체 갱신'}</button>)}<button onClick={async()=>{try{setAudit((await api('/api/audit')).rows);}catch(e:any){setError(e.message);}}}>최근 조회 기록</button></div>{jobs.map(j=><p key={j.id}>{j.source} · {j.progress} · {j.status}{j.error?' · '+j.error:''}</p>)}{audit&&<div className="table-scroll"><table><thead><tr><th>시각</th><th>구분</th><th>조건</th><th>결과</th></tr></thead><tbody>{audit.map((r,i)=><tr key={i}><td>{when(r.at)}</td><td>{r.kind}</td><td>{r.query}</td><td>{r.result}</td></tr>)}</tbody></table></div>}</section>}
 <footer>대구축협 육가공공장 · 공개 가격 · 원본 조회와 저장 가격의 확인 시각을 구분합니다.</footer></main></div></>;
}
