import { createCollector } from '../src/collector.js';

// Fresh in-memory collection: do not mistake a cached snapshot for live source readiness.
const memory = new Map();
const store = {
  read(name, fallback) { return structuredClone(memory.has(name) ? memory.get(name) : fallback); },
  write(name, value) { memory.set(name, structuredClone(value)); },
};
const collector = createCollector(store);
await collector.refresh({ force: true });
const results = collector.state().map(source => ({
  site: source.name,
  status: source.status,
  productCount: source.items.length,
  checkedAt: source.lastAttempt,
  message: source.message,
}));
console.log(JSON.stringify({ liveSourceChecks: results }, null, 2));
if (results.some(result => result.status !== 'ok' || result.productCount === 0)) {
  console.error('실가격 수집 검증 실패: 두 사이트 모두 새 수집에 성공해야 운영 준비 완료로 판단할 수 있습니다.');
  process.exitCode = 1;
}
