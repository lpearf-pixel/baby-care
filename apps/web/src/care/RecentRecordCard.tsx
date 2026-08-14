export interface RecentCareRecord {
  id: string;
  label: string;
  edit: () => Promise<void>;
}

export function RecentRecordCard({
  record,
  busy,
  onEdit,
  onUndo,
}: {
  record: RecentCareRecord;
  busy: boolean;
  onEdit: () => void;
  onUndo: () => void;
}) {
  return (
    <section className="panel recent-record" aria-label="最近护理记录">
      <div>
        <p className="label">最近保存</p>
        <strong>刚刚记录：{record.label}</strong>
      </div>
      <div className="choice-row">
        <button type="button" className="secondary" disabled={busy} onClick={onEdit}>修改</button>
        <button type="button" className="secondary" disabled={busy} onClick={onUndo}>撤销</button>
      </div>
    </section>
  );
}
