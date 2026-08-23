import type { SessionDto, VoiceCareSessionDto } from '@baby-care/contracts';

const warningLabels: Record<string, string> = {
  possible_duplicate: '可能与近期记录重复',
  unusual_value: '数值与近期记录差异较大',
  old_backfill: '这是较早时间的补记',
  overlap: '时间与已有记录重叠',
};

function proposalLabel(session: VoiceCareSessionDto): string {
  const proposal = session.proposal;
  if (proposal.mode === 'bottle' && proposal.liquidType && proposal.amountMl) {
    return `${proposal.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'} ${proposal.amountMl} ml`;
  }
  if (proposal.mode === 'direct_breastfeeding' && proposal.durationMinutes) {
    return `亲喂 ${proposal.durationMinutes} 分钟`;
  }
  return '未完成的喂奶记录';
}

function stateLabel(state: VoiceCareSessionDto['state']): string {
  if (state === 'committed') return '已保存';
  if (state === 'cancelled') return '已取消';
  if (state === 'needs_review') return '需要浏览器复核';
  if (state === 'needs_confirmation') return '待确认';
  if (state === 'committing') return '正在保存';
  return '记录中';
}

export function VoiceCarePendingSessions({
  session,
  sessions,
  busy,
  onConfirm,
  onCancel,
}: {
  session: SessionDto;
  sessions: VoiceCareSessionDto[];
  busy: boolean;
  onConfirm: (item: VoiceCareSessionDto) => Promise<void>;
  onCancel: (item: VoiceCareSessionDto, reason: 'caregiver_cancelled' | 'stale') => Promise<void>;
}) {
  return (
    <section className="voice-care-sessions" aria-label="语音照护记录">
      <h3>语音记录复核</h3>
      {sessions.length === 0 ? <p className="muted">暂无语音照护记录</p> : null}
      <div className="voice-care-grid">
        {sessions.map((item) => (
          <article className="voice-care-session" key={item.id} aria-label={`${item.actorDisplayName} 的待确认语音记录`}>
            <div className="voice-care-session-heading">
              <strong>{proposalLabel(item)}</strong>
              <span>{stateLabel(item.state)}</span>
            </div>
            <p className="muted">照护者：{item.actorDisplayName}</p>
            {item.warningCodes.length > 0 ? (
              <div className="voice-care-warning">
                <strong>保存前请再次确认</strong>
                <ul>{item.warningCodes.map((code) => <li key={code}>{warningLabels[code] ?? '需要人工复核'}</li>)}</ul>
              </div>
            ) : null}
            <div className="voice-care-actions">
              {item.canConfirm && item.proposalDigest ? (
                <button className="primary" type="button" disabled={busy} onClick={() => {
                  if (item.warningCodes.length === 0 || window.confirm('这条语音记录有警告，确认事实无误并保存吗？')) {
                    void onConfirm(item);
                  }
                }}>确认并保存</button>
              ) : null}
              {item.canCancel ? (
                <button className="secondary" type="button" disabled={busy} onClick={() => void onCancel(
                  item,
                  item.actorUserId === session.userId ? 'caregiver_cancelled' : 'stale',
                )}>取消这条语音记录</button>
              ) : null}
              {item.state === 'committed' && item.finalCareEventId ? (
                <a href={`#care-event-${item.finalCareEventId}`}>查看已保存护理记录</a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
