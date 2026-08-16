import type { CareHandoffBriefingDto, CareTimelineCategory, CareTimelineItemDto } from '@baby-care/contracts';
import { useState } from 'react';
import type { BabyCareApi } from '../api-client.js';
import { formatCareTimelineSummary, formatDateTime } from './CareTimelineCard.js';
import { HandoffReminderSettings } from './HandoffReminderSettings.js';

function windowLabel(briefing: CareHandoffBriefingDto, familyTimeZone: string): string {
  const from = formatDateTime(briefing.window.from, familyTimeZone);
  const to = formatDateTime(briefing.window.to, familyTimeZone);
  if (briefing.window.mode === 'rolling_24h') return `窗口 ${from} → ${to}`;
  return `交接窗口 ${from} → ${to}`;
}

function elapsedLabel(from: string, asOf: string): string {
  const minutes = Math.max(0, Math.floor((new Date(asOf).getTime() - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}小时前` : `${hours}小时${remainder}分钟前`;
}

function lastFeedingLabel(briefing: CareHandoffBriefingDto): string {
  const feeding = briefing.careState.lastFeeding;
  if (!feeding) return '上次喂奶 · 暂无记录';
  const facts = [
    feeding.bottle
      ? `${feeding.bottle.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'} ${feeding.bottle.amountMl}ml`
      : null,
    feeding.directBreastfeedingMinutes ? `亲喂 ${feeding.directBreastfeedingMinutes}min` : null,
  ].filter(Boolean).join(' · ');
  return `上次喂奶 · ${facts} · ${elapsedLabel(feeding.occurredAt, briefing.careState.asOf)}`;
}

function lastDiaperLabel(briefing: CareHandoffBriefingDto): string {
  const diaper = briefing.careState.lastDiaper;
  if (!diaper) return '上次尿布 · 暂无记录';
  const kind = diaper.kind === 'urine' ? '尿' : diaper.kind === 'stool' ? '便' : '尿+便';
  return `上次尿布 · ${kind} · ${elapsedLabel(diaper.occurredAt, briefing.careState.asOf)}`;
}

function currentSleepLabel(briefing: CareHandoffBriefingDto): string {
  const sleep = briefing.careState.currentSleep;
  if (!sleep) return '当前状态 · 清醒 / 未记录睡眠';
  const minutes = Math.max(0, Math.floor(
    (new Date(briefing.careState.asOf).getTime() - new Date(sleep.startedAt).getTime()) / 60000,
  ));
  return `睡眠中 · ${minutes}min`;
}

function timelineCategory(item: CareTimelineItemDto): CareTimelineCategory {
  return item.eventType === 'feeding' || item.eventType === 'diaper' || item.eventType === 'sleep'
    ? item.eventType
    : 'other';
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
  familyTimeZone,
}: {
  api: BabyCareApi;
  briefing: CareHandoffBriefingDto | null;
  loading: boolean;
  busy: boolean;
  message: string | null;
  onTakeOver: () => Promise<boolean>;
  onReload: () => Promise<void>;
  onJumpToWindow: (from: string, to: string, category: CareTimelineCategory) => void;
  familyTimeZone: string;
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
          <p>{windowLabel(briefing, familyTimeZone)}</p>
          <a href="#care-timeline-list" onClick={(event) => {
            event.preventDefault();
            onJumpToWindow(briefing.window.from, briefing.window.to, 'all');
          }}>{briefing.window.mode === 'rolling_24h' ? '查看这24小时护理记录' : '查看全部交接窗口记录'}</a>
          <div className="handoff-care-state" aria-label="交接时护理状态">
            <button type="button" className="text-button" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'feeding')}>
              {lastFeedingLabel(briefing)}
            </button>
            <button type="button" className="text-button" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'diaper')}>
              {lastDiaperLabel(briefing)}
            </button>
            <button type="button" className="text-button" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'sleep')}>
              {currentSleepLabel(briefing)}
            </button>
          </div>
          <dl className="facts">
            <div>
              <dt>喂养总量</dt>
              <dd><button type="button" className="text-button" aria-label="查看总瓶喂汇总" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'feeding')}>总瓶喂 {briefing.feeding.bottleTotalMl}ml</button></dd>
            </div>
            <div>
              <dt>母乳瓶喂</dt>
              <dd><button type="button" className="text-button" aria-label="查看母乳瓶喂汇总" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'feeding')}>母乳瓶喂 {briefing.feeding.expressedBreastMilkMl}ml</button></dd>
            </div>
            <div>
              <dt>配方奶</dt>
              <dd><button type="button" className="text-button" aria-label="查看配方奶汇总" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'feeding')}>配方奶 {briefing.feeding.formulaMl}ml</button></dd>
            </div>
            <div>
              <dt>亲喂</dt>
              <dd><button type="button" className="text-button" aria-label="查看亲喂汇总" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'feeding')}>亲喂 {briefing.feeding.directBreastfeedingSessions}次 · {briefing.feeding.directBreastfeedingMinutes}min</button></dd>
            </div>
            <div>
              <dt>尿布</dt>
              <dd><button type="button" className="text-button" aria-label="查看尿布汇总" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'diaper')}>尿 {briefing.diapers.urine} · 便 {briefing.diapers.stool} · 尿+便 {briefing.diapers.urineStool}</button></dd>
            </div>
            <div>
              <dt>睡眠</dt>
              <dd><button type="button" className="text-button" aria-label="查看睡眠汇总" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'sleep')}>睡眠 {briefing.sleep.intervals}段 · {briefing.sleep.completedMinutes}min</button></dd>
            </div>
            <div>
              <dt>照护者活动</dt>
              <dd><button type="button" className="text-button" aria-label="查看照护者活动" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'all')}>{actorSummary(briefing)}</button></dd>
            </div>
            <div>
              <dt>修正</dt>
              <dd><button type="button" className="text-button" aria-label="查看修正涉及的记录" onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, 'all')}>{correctionSummary(briefing)}</button></dd>
            </div>
          </dl>
          <section className="handoff-notable-events" aria-label="重点护理记录">
            <h3>重点护理记录</h3>
            <p className="muted">显示 {Math.min(briefing.notableEvents.length, 20)} / {briefing.notableEventCount} 条重点记录</p>
            <ul>
              {briefing.notableEvents.slice(0, 20).map((item) => {
                const fact = formatCareTimelineSummary(item);
                return <li key={item.id}><button type="button" className="text-button" aria-label={`查看${fact}`} onClick={() => onJumpToWindow(briefing.window.from, briefing.window.to, timelineCategory(item))}>{fact}</button></li>;
              })}
            </ul>
          </section>
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
