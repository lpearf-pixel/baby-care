import { useState } from 'react';
import type { BabyCareApi } from '../api-client.js';
import { CareSummary } from './CareSummary.js';
import { DiaperForm } from './DiaperForm.js';
import { FeedingForm } from './FeedingForm.js';
import { QuickRecordBar, type CareQuickAction } from './QuickRecordBar.js';
import { SleepControls } from './SleepControls.js';
import { useCareWorkspace } from './useCareWorkspace.js';

export function CareWorkspace({ api }: { api: BabyCareApi }) {
  const [active, setActive] = useState<CareQuickAction | null>(null);
  const { summary, loading, busy, message, save } = useCareWorkspace(api);

  return (
    <section className="care-workspace" aria-label="Baby Care 护理工作台">
      {loading ? <section className="panel"><p>正在加载护理状态…</p></section> : null}
      {!loading && summary ? <CareSummary summary={summary} /> : null}
      {!loading && !summary ? (
        <section className="panel">
          <h2>护理状态</h2>
          <p className="muted">护理状态暂时无法加载，仍可稍后重试。</p>
        </section>
      ) : null}

      <QuickRecordBar active={active} onSelect={(next) => setActive(active === next ? null : next)} />

      {active === 'feeding' ? (
        <FeedingForm
          api={api}
          busy={busy}
          onSave={(input) => save(() => api.createFeedingSession(input))}
        />
      ) : null}
      {active === 'diaper' ? (
        <DiaperForm busy={busy} onSave={(input) => save(() => api.createDiaper(input))} />
      ) : null}
      {active === 'sleep' ? (
        <SleepControls
          sleeping={Boolean(summary?.currentSleep)}
          busy={busy}
          onStart={(input) => save(() => api.startSleep(input))}
          onWake={(input) => save(() => api.wakeSleep(input))}
        />
      ) : null}

      {message ? <p className="inline-message care-message" aria-live="polite">{message}</p> : null}
    </section>
  );
}
