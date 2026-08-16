import type { CareHandoffBriefingDto } from '@baby-care/contracts';
import { useState } from 'react';
import type { BabyCareApi } from '../api-client.js';
import { formatDateTime } from './CareTimelineCard.js';
import { HandoffReminderSettings } from './HandoffReminderSettings.js';

function windowLabel(briefing: CareHandoffBriefingDto): string {
  const from = formatDateTime(briefing.window.from);
  const to = formatDateTime(briefing.window.to);
  if (briefing.window.mode === 'rolling_24h') return `窗口 ${from} → ${to}`;
  return `交接窗口 ${from} → ${to}`;
}

function headingLabel(briefing: CareHandoffBriefingDto): string {
  return briefing.window.mode === 'rolling_24h' ? '最近24小时交接摘要' : '固定交接摘要';
}

function actorSummary(briefing: CareHandoffBriefingDto): string {
  return briefing.actorActivity.map((item) => `${item.actorDisplayName ?? '系统'} ${item.eventCount} 条`).join(' · ');
}

function correctionSummary(briefing: CareHandoffBriefingDto): string {
  if (!briefing.corrections.length) return '最近修正 0 条';
  const latest = briefing.corrections[0]!;
  return `最近修正 ${briefing.correctionCount} 条 · ${latest.actorDisplayName} ${latest.action}`;
}

export function HandoffPanel({
  api,
  briefing,
  loading,
  busy,
  message,
  onTakeOver,
  onReload,
  onJumpToWindow,
}: {
  api: BabyCareApi;
  briefing: CareHandoffBriefingDto | null;
  loading: boolean;
  busy: boolean;
  message: string | null;
  onTakeOver: () => Promise<boolean>;
  onReload: () => Promise<void>;
  onJumpToWindow: (from: string, to: string) => void;
}) {
  const [takeoverVersion, setTakeoverVersion] = useState(0);

  async function takeOver() {
    const succeeded = await onTakeOver();
    if (succeeded) setTakeoverVersion((version) => version + 1);
    return succeeded;
  }

  return (
    <section className="panel care-handoff" aria-label="交接摘要">
      <div className="care-panel-header">
        <h2>交接摘要</h2>
        <button type="button" className="text-button" onClick={() => void onReload()}>
          {briefing ? '刷新交接摘要' : '重试交接摘要'}
        </button>
      </div>

      <p className="inline-message care-message" role="status" aria-live="polite">
        {message ?? (loading ? '正在加载交接摘要…' : '交接摘要已更新')}
      </p>

      {briefing ? (
        <>
          <strong>{headingLabel(briefing)}</strong>
          <p>{windowLabel(briefing)}</p>
          {briefing.window.mode === 'rolling_24h' ? (
            <a
              href="#care-timeline-list"
              onClick={(event) => {
                event.preventDefault();
                onJumpToWindow(briefing.window.from, briefing.window.to);
              }}
            >
              查看这24小时护理记录
            </a>
          ) : null}
          <dl className="facts">
            <div>
              <dt>喂养总量</dt>
              <dd>总瓶喂 {briefing.feeding.bottleTotalMl}ml</dd>
            </div>
            <div>
              <dt>母乳瓶喂</dt>
              <dd>母乳瓶喂 {briefing.feeding.expressedBreastMilkMl}ml</dd>
            </div>
            <div>
              <dt>配方奶</dt>
              <dd>配方奶 {briefing.feeding.formulaMl}ml</dd>
            </div>
            <div>
              <dt>亲喂</dt>
              <dd>亲喂 {briefing.feeding.directBreastfeedingSessions}次 · {briefing.feeding.directBreastfeedingMinutes}min</dd>
            </div>
            <div>
              <dt>尿布 / 睡眠</dt>
              <dd>尿 {briefing.diapers.urine} · 便 {briefing.diapers.stool} · 睡眠 {briefing.sleep.completedMinutes}min</dd>
            </div>
            <div>
              <dt>照护者活动</dt>
              <dd>{actorSummary(briefing)}</dd>
            </div>
            <div>
              <dt>修正</dt>
              <dd>{correctionSummary(briefing)}</dd>
            </div>
          </dl>
        </>
      ) : !message ? (
        <p className="muted">尚无交接记录</p>
      ) : null}

      <div className="choice-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void takeOver()}>
          我来接手
        </button>
      </div>

      <HandoffReminderSettings api={api} onTakeOver={takeOver} takeoverVersion={takeoverVersion} />
    </section>
  );
}
