import type { EditCareEventInput } from '@baby-care/contracts';
import { CareEventEditForm } from './CareEventEditForm.js';

export function RecentEditPanel({
  input,
  busy,
  onSave,
  onCancel,
}: {
  input: EditCareEventInput;
  busy: boolean;
  onSave: (input: EditCareEventInput) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <CareEventEditForm
      input={input}
      busy={busy}
      ariaLabel="修改最近护理记录"
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}
