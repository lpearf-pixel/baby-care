import type { CareWarning } from '@baby-care/contracts';

export function CareWarningDialog({
  warnings,
  busy,
  onContinue,
  onCancel,
}: {
  warnings: readonly CareWarning[];
  busy: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="panel warning-dialog" role="dialog" aria-label="确认这条护理记录" aria-modal="true">
      <h3>确认这条护理记录</h3>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`}>{warning.summary}</li>
        ))}
      </ul>
      <div className="choice-row">
        <button type="button" className="primary" disabled={busy} onClick={onContinue}>继续记录</button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>返回修改</button>
      </div>
    </section>
  );
}
