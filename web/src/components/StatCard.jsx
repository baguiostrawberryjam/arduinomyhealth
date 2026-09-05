import { formatDateTime } from '../format.js';
import MetricIcon from './MetricIcon.jsx';
import StatusPill from './StatusPill.jsx';

/**
 * One metric of the latest reading. `reading` is rows.at(-1) — the same row
 * feeds all three cards, so they can never disagree about when they are from.
 *
 * data-metric is what ties the icon chip and the background wash to this
 * metric's hue; the colours themselves come from styles.css.
 */
export default function StatCard({ metric, reading, loading }) {
  if (loading) {
    return (
      <div className="card stat-card" data-metric={metric.key}>
        <div className="stat-head">
          <span className="stat-icon">
            <MetricIcon name={metric.key} />
          </span>
          <span className="stat-label">{metric.label}</span>
        </div>
        <div className="stat-value">
          <span className="skeleton" style={{ width: 104, height: 46 }} />
        </div>
        <div className="stat-foot">
          <span className="skeleton skeleton-line" style={{ width: 140 }} />
        </div>
      </div>
    );
  }

  const value = reading ? reading[metric.key] : null;
  const status = value === null || value === undefined ? null : metric.status(value);

  return (
    <div
      className={`card stat-card${value === null ? ' stat-empty' : ''}`}
      data-metric={metric.key}
    >
      <div className="stat-head">
        <span className="stat-icon">
          <MetricIcon name={metric.key} />
        </span>
        <span className="stat-label">{metric.label}</span>
        <StatusPill status={status} />
      </div>
      <div className="stat-value">
        <span className="stat-number">{value === null ? '—' : metric.format(value)}</span>
        <span className="stat-unit">{metric.unit}</span>
      </div>
      <div className="stat-foot">
        <span>Normal: {metric.normalRange}</span>
        {reading && <span>{formatDateTime(reading.recordedAt)}</span>}
      </div>
    </div>
  );
}
