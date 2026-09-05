import { STATUS_LABEL } from '../constants.js';

/**
 * Normal / Low / High, using the same thresholds the Catcher Device shows on its own
 * screen. `status` is null when there is no reading to judge.
 */
export default function StatusPill({ status }) {
  if (!status) return <span className="pill pill-none">No data</span>;
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}
