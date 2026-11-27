import { Icon } from './Icon';

interface PeriodNavigatorProps {
  title: string;
  subtitle?: string;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  compact?: boolean;
  disabled?: boolean;
}

export function PeriodNavigator({
  title,
  subtitle,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  compact = false,
  disabled = false,
}: PeriodNavigatorProps) {
  return (
    <div className={`period-navigator${compact ? ' compact' : ''}`}>
      <button
        type="button"
        className="icon-button plain"
        onClick={onPrevious}
        aria-label={previousLabel}
        disabled={disabled}
      >
        <Icon name="chevron-left" size={19} />
      </button>
      <div className="period-navigator-text">
        <div className="period-title">{title}</div>
        {subtitle ? (
          <div className="period-subtitle">{subtitle}</div>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-button plain"
        onClick={onNext}
        aria-label={nextLabel}
        disabled={disabled}
      >
        <Icon name="chevron-right" size={19} />
      </button>
    </div>
  );
}
