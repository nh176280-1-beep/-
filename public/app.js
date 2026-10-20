const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { user: null, sources: [], view: 'prices', source: 'all', search: '', sort: 'name', favorites: new Set(), requestFailed: false };
let toastTimer, pollTimer;
let pricePage = 1, priceQuery = '', pricePageCount = 1;
let lastPriceLoad = 0, loadingPrices = false;
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
async function api(path, payload) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(payload !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  if (response.status === 401 && path !== '/api/login') showLogin();
  if (!response.ok) throw Object.assign(new Error(result.error || '요청에 실패했습니다.'), { code: result.code, status: response.status });
  return result;
}
function formatTime(value) {
  if (!value) return '아직 확인 전';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
const favoriteKey = item => JSON.stringify([item.sourceId, item.url, item.name, item.grade, item.unit]);
function saveFavorites() {
  try { localStorage.setItem(`favorites:${state.user.username}`, JSON.stringify([...state.favorites])); } catch { toast('이 브라우저에서 관심 품목을 저장할 수 없습니다.'); }
}
function showLogin() {
  state.user = null;
  state.sources = [];
  state.favorites.clear();
  $('#price-grid').replaceChildren();
  $('#source-status').replaceChildren();
  $('#user-list').replaceChildren();
  $('#source-forms').replaceChildren();
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
  $('#loading').hidden = true;
  clearInterval(pollTimer);
}
async function showApp(user) {
  state.user = user;
  state.view = 'prices'; state.source = 'all'; state.search = '';
  $('#search').value = '';
  try { state.favorites = new Set(JSON.parse(localStorage.getItem(`favorites:${user.username}`) || '[]')); } catch { state.favorites = new Set(); }
  $('#user-name').textContent = `${user.name} 님`;
  $$('.admin-only').forEach(node => { node.hidden = user.role !== 'admin'; });
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#loading').hidden = true;
  await loadPrices();
  changeView('prices');
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && (state.sources.some(source => source.collecting) || Date.now() - lastPriceLoad >= 60_000)) loadPrices(); }, 10_000);
}
async function loadPrices() {
  if (loadingPrices) return false;
  loadingPrices = true;
  try {
    const data = await api('/api/prices');
    state.sources = data.sources;
    lastPriceLoad = Date.now();
    state.requestFailed = false;
    renderPrices();
    return true;
  } catch (error) {
    if (!state.user) return false;
    state.requestFailed = true;
    renderPrices();
    toast(error.message === 'Failed to fetch' ? '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.' : error.message);
    return false;
  } finally {
    loadingPrices = false;
  }
}
function isStale(source) { return source.status !== 'ok' || !source.lastSuccess || Date.now() - new Date(source.lastSuccess).getTime() > 60 * 60_000; }
function renderPrices() {
  const all = state.sources.flatMap(source => (source.items || []).map(item => ({ ...item, lastSuccess: source.lastSuccess, stale: isStale(source) || state.requestFailed })));
  $('#total-items').textContent = all.length ? all.length.toLocaleString('ko-KR') : '—';
  $('#favorite-count').textContent = state.favorites.size;
  const cards = state.sources.map(source => {
    const card = el('div', 'source-card');
    const detail = el('div');
    const progress = source.progress;
    detail.append(el('strong', '', source.name), el('p', '', source.collecting ? `전체 수집 중 · ${(progress?.scanned || 0).toLocaleString('ko-KR')}개 확인${progress?.sourceTotal ? ` / ${progress.sourceTotal.toLocaleString('ko-KR')}개` : ''}` : source.lastSuccess ? `${formatTime(source.lastSuccess)} 확인 · ${source.items?.length || 0}개` : '원본 가격 확인 대기'));
    if (source.coverage && !source.collecting) detail.append(el('p', '', `${source.coverage.scanned.toLocaleString('ko-KR')}개 조회 · 가격 제외 ${source.coverage.excludedCount.toLocaleString('ko-KR')}개${source.coverage.unavailableCount ? ` · 원본 목록 차이 ${source.coverage.unavailableCount.toLocaleString('ko-KR')}개` : ''}`));
    if (source.coverage?.changedDuringCollection && !source.collecting) detail.append(el('p', '', `수집 중 재고 변동 · 시작 ${source.coverage.sourceTotalAtStart.toLocaleString('ko-KR')}개 → 종료 ${source.coverage.sourceTotal.toLocaleString('ko-KR')}개`));
    const status = source.collecting ? ['pending', '전체 수집 중'] : source.status === 'partial' ? ['error', '일부 확인'] : source.status === 'ok' && !isStale(source) ? ['ok', '확인 완료'] : source.status === 'error' ? ['error', '연결 확인 필요'] : ['pending', source.lastSuccess ? '갱신 지연' : '확인 대기'];
    card.append(el('span', 'source-avatar', source.id === 'ekcm' ? 'E' : '일'), detail, el('span', `status-pill ${status[0]}`, status[1]));
    return card;
  });
  $('#source-status').replaceChildren(...cards);
  const errors = state.sources.filter(source => ['error', 'partial'].includes(source.status));
  const warning = $('#connection-warning');
  warning.hidden = !errors.length && !state.requestFailed;
  warning.textContent = state.requestFailed ? '서버 연결이 끊겼습니다. 아래 정보는 이전에 조회한 내용이며 최신 여부를 확인할 수 없습니다.' : errors.map(source => `${source.name}: ${state.user?.role === 'admin' ? source.message : '최신 가격을 확인하지 못했습니다. 원본 사이트에서 확인해 주세요.'}`).join(' / ');
  let items = all.filter(item => (state.source === 'all' || item.sourceId === state.source) && (state.view !== 'favorites' || state.favorites.has(favoriteKey(item))) && `${item.name} ${item.grade} ${item.unit}`.toLowerCase().includes(state.search.toLowerCase().trim()));
  items.sort(state.sort === 'recent' ? (a, b) => new Date(b.lastSuccess) - new Date(a.lastSuccess) || a.name.localeCompare(b.name, 'ko') : (a, b) => a.name.localeCompare(b.name, 'ko'));
  $('#result-count').textContent = items.length.toLocaleString('ko-KR');
  const query = JSON.stringify([state.source, state.view, state.search, state.sort]);
  if (query !== priceQuery) { pricePage = 1; priceQuery = query; }
  pricePageCount = Math.max(1, Math.ceil(items.length / 100));
  pricePage = Math.min(pricePage, pricePageCount);
  $('#price-grid').replaceChildren(...items.slice((pricePage - 1) * 100, pricePage * 100).map(priceCard));
  $('#price-pagination').hidden = items.length <= 100;
  $('#price-page-info').textContent = `${pricePage} / ${pricePageCount} 페이지 · 전체 ${items.length.toLocaleString('ko-KR')}개`;
  $('#price-previous').disabled = pricePage <= 1;
  $('#price-next').disabled = pricePage >= pricePageCount;
  $('#empty-state').hidden = Boolean(items.length);
  if (state.view === 'favorites' && !items.length) {
    $('#empty-title').textContent = '관심 품목을 모아보세요';
    $('#empty-description').textContent = '가격 카드의 별을 누르면 이곳에서 빠르게 확인할 수 있습니다.\n현재 조회 조건에 맞는 관심 품목이 없습니다.';
  } else if (all.length && !items.length) {
    $('#empty-title').textContent = '검색 결과가 없습니다';
    $('#empty-description').textContent = '다른 품목명이나 등급으로 검색해 보세요.';
  } else {
    $('#empty-title').textContent = '가격 정보를 준비하고 있습니다';
    $('#empty-description').textContent = '원본 사이트에서 가격이 확인되면 이곳에 표시됩니다.\n확인되지 않은 가격은 표시하지 않습니다.';
  }
  $$('.tab').forEach(tab => { tab.classList.toggle('selected', tab.dataset.source === state.source); tab.setAttribute('aria-pressed', String(tab.dataset.source === state.source)); });
}
function priceCard(item) {
  const card = el('article', 'price-card');
  const top = el('div', 'card-top');
  const saved = state.favorites.has(favoriteKey(item));
  const favorite = el('button', `favorite-button ${saved ? 'saved' : ''}`, saved ? '★' : '☆');
  favorite.setAttribute('aria-label', `${item.name} 관심 품목 ${saved ? '해제' : '추가'}`);
  favorite.setAttribute('aria-pressed', String(saved));
  favorite.addEventListener('click', () => {
    const key = favoriteKey(item);
    if (state.favorites.has(key)) state.favorites.delete(key); else state.favorites.add(key);
    saveFavorites(); renderPrices();
    // Restore keyboard focus after replacing the list.
    $$('.favorite-button').find(button => button.getAttribute('aria-label')?.startsWith(`${item.name} 관심 품목`))?.focus({ preventScroll: true });
  });
  top.append(el('span', 'source-tag', item.sourceName), favorite);
  const meta = el('div', 'item-meta');
  [item.grade, item.availability].filter(Boolean).forEach(text => meta.append(el('span', '', text)));
  const price = el('p', 'price', item.price.toLocaleString('ko-KR'));
  price.append(el('small', '', '원'));
  const bottom = el('div', 'card-bottom');
  const link = el('a', '', '원본 확인 ↗');
  link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  bottom.append(el('span', '', `${formatTime(item.lastSuccess)} 확인`), link);
  card.append(top, el('h3', '', item.name), meta, price, el('p', 'unit', item.unit === '단위 미표기' ? '판매 단위 · 원본 확인 필요' : `판매 단위 · ${item.unit}`));
  if (item.lotWeight) card.append(el('p', 'unit', `상품 중량 ${item.lotWeight}${item.totalPrice ? ` · 총 ${item.totalPrice.toLocaleString('ko-KR')}원` : ''}`));
  if (item.stale) card.append(el('p', 'stale', '갱신 지연 · 마지막 확인 가격'));
  card.append(bottom);
  return card;
}
async function changeView(view) {
  state.view = view;
  $('#price-view').hidden = view === 'settings';
  $('#settings-view').hidden = view !== 'settings';
  $$('.nav-item').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
  if (view === 'settings') { renderSourceForms(); await loadUsers(); }
  else {
    $('#page-title').replaceChildren(document.createTextNode(view === 'favorites' ? '자주 찾는 관심 품목' : '오늘의 가격, 한눈에'), el('span', 'heading-dot', '.'));
    $('#page-description').textContent = view === 'favorites' ? '별표로 저장한 품목만 모아서 확인하세요.' : '두 사이트의 가격 정보를 한곳에서 확인하세요.';
    renderPrices();
  }
}
function renderSourceForms() {
  $('#source-forms').replaceChildren(...state.sources.map(source => {
    const form = el('form', 'source-form');
    const label = el('label', '', `${source.name} 가격 페이지`);
    const input = el('input'); input.type = 'url'; input.required = true; input.value = source.pageUrl; input.setAttribute('aria-label', `${source.name} 가격 페이지 주소`);
    const button = el('button', 'button secondary', '주소 저장'); button.type = 'submit';
    label.append(input); form.append(label, button);
    form.addEventListener('submit', async event => {
      event.preventDefault(); button.disabled = true;
      try { await api('/api/sources', { id: source.id, url: input.value }); await loadPrices(); toast('주소를 저장했습니다. 지금 수집을 눌러 확인하세요.'); }
      catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
    return form;
  }));
}
async function loadUsers() {
  try {
    const { users } = await api('/api/users');
    $('#user-list').replaceChildren(...users.map(user => {
      const row = el('div', 'user-row');
      const detail = el('div', '', user.name); detail.append(el('small', '', `${user.username} · ${user.role === 'admin' ? '관리자' : '직원'}${user.disabled ? ' · 사용 중지' : ''}`));
      row.append(detail);
      if (user.role !== 'admin' && !user.disabled) {
        const button = el('button', 'text-button', '사용 중지');
        button.addEventListener('click', async () => {
          if (!confirm(`${user.name} 님의 로그인을 중지할까요?`)) return;
          try { await api('/api/users/disable', { username: user.username }); await loadUsers(); toast('계정 사용을 중지했습니다.'); } catch (error) { toast(error.message); }
        }); row.append(button);
      }
      return row;
    }));
  } catch (error) { toast(error.message); }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button'); button.disabled = true;
  $('#login-error').textContent = '';
  try {
    const result = await api('/api/login', { username: $('#username').value.trim(), password: $('#password').value });
    $('#password').value = '';
    await showApp(result.user);
  } catch (error) { $('#login-error').textContent = error.message === 'Failed to fetch' ? '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.' : error.message; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', {}); showLogin(); } catch (error) { toast(error.message); } });
$$('.nav-item').forEach(button => button.addEventListener('click', () => changeView(button.dataset.view)));
$$('.tab').forEach(button => button.addEventListener('click', () => { state.source = button.dataset.source; renderPrices(); }));
$('#search').addEventListener('input', event => { state.search = event.target.value; renderPrices(); });
$('#sort').addEventListener('change', event => { state.sort = event.target.value; renderPrices(); });
$('#price-previous').addEventListener('click', () => { if (pricePage > 1) { pricePage--; renderPrices(); } });
$('#price-next').addEventListener('click', () => { if (pricePage < pricePageCount) { pricePage++; renderPrices(); } });
$('#reload').addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; if (await loadPrices()) toast('최신 저장 정보를 조회했습니다.'); button.disabled = false; });
$('#refresh-source').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; button.textContent = '수집 중…';
  try { const result = await api('/api/refresh', {}); await loadPrices(); toast(result.refreshing ? '전체 수집을 진행하고 있습니다. 가격 조회에서 진행 건수를 확인하세요.' : '수집 요청은 1분 간격으로 가능합니다.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '지금 수집'; }
});
$('#add-user-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const button = form.querySelector('button'); button.disabled = true;
  try { await api('/api/users', Object.fromEntries(new FormData(form))); form.reset(); await loadUsers(); toast('직원 계정을 추가했습니다.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
window.addEventListener('online', () => { if (state.user) loadPrices(); });
$('#reset-user-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const button = form.querySelector('button'); button.disabled = true;
  try { await api('/api/users/reset', Object.fromEntries(new FormData(form))); form.reset(); await loadUsers(); toast('직원 비밀번호를 재설정하고 계정을 활성화했습니다.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
window.addEventListener('offline', () => { if (state.user) { state.requestFailed = true; renderPrices(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.user) loadPrices(); });
try { const result = await api('/api/me'); await showApp(result.user); }
catch (error) {
  showLogin();
  if (error.code === 'SETUP_REQUIRED') {
    $('#login-error').textContent = error.message;
    $('#login-form').querySelectorAll('input, button').forEach(control => { control.disabled = true; });
  } else if (error.status !== 401) {
    $('#login-error').textContent = '서버에 연결할 수 없습니다. 인터넷 연결과 접속 주소를 확인한 뒤 다시 시도해 주세요.';
  }
}
