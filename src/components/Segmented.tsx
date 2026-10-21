interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedProps {
  value: string;
  options: SegmentedOption[];
  onChange: (value: string) => void;
  label: string;
}

export function Segmented({ value, options, onChange, label }: SegmentedProps) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className="segment"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
