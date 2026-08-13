import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'online' | 'offline';
const statusCopy: Record<ApiStatus, string> = { checking: 'API 检查中', online: 'API 在线', offline: '当前离线' };

export function App({ apiStatus: forcedStatus }: { apiStatus?: ApiStatus }) {
  const [observedStatus, setObservedStatus] = useState<ApiStatus>('checking');
  const status = forcedStatus ?? observedStatus;
  useEffect(() => {
    if (forcedStatus) return;
    const controller = new AbortController();
    fetch('/api/health/live', { signal: controller.signal })
      .then((response) => setObservedStatus(response.ok ? 'online' : 'offline'))
      .catch(() => setObservedStatus('offline'));
    return () => controller.abort();
  }, [forcedStatus]);
  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">程序员爸爸的科学育儿实验室</p>
          <h1>Baby Care</h1>
          <p className="baby-name">xiangxiang</p>
        </div>
        <span className={`status status-${status}`} data-api-status={status}>{statusCopy[status]}</span>
      </header>
      <section className="card" aria-labelledby="foundation-title">
        <p className="section-kicker">Birth Ready · M0</p>
        <h2 id="foundation-title">家庭护理工作台正在搭建</h2>
        <p>这一版先确保 Web/PWA、API、数据库、自动测试和备份基础可靠。</p>
        <p className="muted">护理记录功能将在后续里程碑启用；进入护理阶段前会先采集真实家庭使用习惯。</p>
      </section>
      <section className="card compact" aria-label="离线说明">
        <strong>本地优先</strong>
        <span>当前离线时仍可打开应用外壳；正式护理数据的离线写入将在可靠性阶段实现。</span>
      </section>
    </main>
  );
}
