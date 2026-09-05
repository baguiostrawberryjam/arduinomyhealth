import { RANGES } from '../constants.js';

/** Segmented 24h / 7d / 30d. Changing it is the only thing that refetches. */
export default function RangeControl({ value, onChange, disabled }) {
  return (
    <div className="segmented" role="group" aria-label="Time range">
      {RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          onClick={() => onChange(range.key)}
          aria-pressed={value === range.key}
          aria-label={`Last ${range.label}`}
          disabled={disabled}
        >
          {range.short}
        </button>
      ))}
    </div>
  );
}
