interface ProgressBarProps {
  value: number;
  label?: string;
  showOver?: boolean;
}

export function ProgressBar({ value, label, showOver = true }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(1, value)) * 100;
  const state = value >= 1 ? (showOver ? 'over' : 'done') : '';
  return (
    <div>
      {label ? (
        <div className="progress-label">
          <span>{label}</span>
          <span>{Math.round(value * 100)} %</span>
        </div>
      ) : null}
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={`progress-bar ${state}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
