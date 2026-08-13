import { useEffect, useState } from 'react';
import type { HealthResponse } from '@baby-care/contracts';
import { loadApiHealth } from './health-client.js';
import './app.css';

export interface AppProps {
  loadHealth?: () => Promise<HealthResponse>;
}

type Availability = 'checking' | 'online' | 'degraded';

export function App({ loadHealth = loadApiHealth }: AppProps) {
  const [availability, setAvailability] = useState<Availability>('checking');

  useEffect(() => {
    let active = true;

    void loadHealth()
      .then((health) => {
        if (active) {
          setAvailability(health.status === 'ok' ? 'online' : 'degraded');
        }
      })
      .catch(() => {
        if (active) {
          setAvailability('degraded');
        }
      });

    return () => {
      active = false;
    };
  }, [loadHealth]);

  const statusText =
    availability === 'online'
      ? '系统在线'
      : availability === 'degraded'
        ? '服务暂不可用'
        : '正在检查系统';

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="product-title">
        <p className="eyebrow">Birth Ready · Web/PWA</p>
        <h1 id="product-title">Baby Care</h1>
        <p className="subtitle">xiangxiang 的家庭护理工作台</p>
      </section>

      <section className="status-card" aria-live="polite">
        <div>
          <p className="label">宝宝</p>
          <strong>xiangxiang</strong>
        </div>
        <div className="system-state">
          <span className={`status-dot ${availability}`} aria-hidden="true" />
          <span>{statusText}</span>
        </div>
      </section>

      <p className="foundation-note">
        当前为基础版本。护理记录将在真实家庭习惯确认后启用。
      </p>
    </main>
  );
}
