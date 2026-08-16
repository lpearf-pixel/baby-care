import { useCareDisplayMode, type CareDisplayMode as DisplayMode } from './useCareDisplayMode.js';

const options: { value: DisplayMode; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'day', label: '日间' },
  { value: 'night', label: '夜间' },
];

export function CareDisplayMode() {
  const { mode, resolvedMode, setMode } = useCareDisplayMode();

  return (
    <section className="panel care-display-mode" aria-labelledby="care-display-mode-title">
      <div>
        <h2 id="care-display-mode-title">显示模式</h2>
        <p className="muted">只保存在当前浏览器，不会改变家庭护理记录。</p>
      </div>
      <div className="choice-row care-display-choices" role="group" aria-label="护理工作台显示模式">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={mode === option.value ? 'primary' : 'secondary'}
            aria-pressed={mode === option.value}
            onClick={() => setMode(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="care-display-status" aria-live="polite">
        当前使用{resolvedMode === 'night' ? '夜间' : '日间'}显示{mode === 'auto' ? '（自动）' : ''}
      </p>
    </section>
  );
}
