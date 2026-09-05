import { useEffect, useMemo, useState } from 'react';
import { bpmStatus, spo2Status, tempStatus } from '../constants.js';
import { formatTimestamp } from '../format.js';

const PAGE_SIZE = 25;

function cellClass(status) {
  if (status === 'high') return 'num cell-flag';
  if (status === 'low') return 'num cell-flag cell-flag-low';
  return 'num';
}

/**
 * Every reading in the selected range, newest first.
 *
 * The contract guarantees `rows` ascending, so the reversal happens here rather
 * than at the fetch — the charts want it ascending and this is the only surface
 * that wants it the other way round.
 */
export default function ReadingsTable({ rows, loading }) {
  const [page, setPage] = useState(0);

  const ordered = useMemo(() => [...rows].reverse(), [rows]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));

  // A range switch can leave you on a page that no longer exists.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const start = page * PAGE_SIZE;
  const visible = ordered.slice(start, start + PAGE_SIZE);

  if (loading) {
    return (
      <div className="card">
        <div className="card-pad">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="skeleton skeleton-line"
              style={{ marginBottom: 14, width: `${92 - i * 6}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <p className="empty-title">No readings yet</p>
          <p className="empty-body">
            Readings appear here as soon as you take them at the Catcher Device. Nothing is recorded while
            nobody is using it, so your history stays clean.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="table-scroll">
        <table className="readings">
          <thead>
            <tr>
              <th scope="col">Date &amp; time</th>
              <th scope="col" className="col-num">
                Heart rate
              </th>
              <th scope="col" className="col-num">
                SpO&#8322;
              </th>
              <th scope="col" className="col-num">
                Temp
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td className="time-cell">{formatTimestamp(row.recordedAt)}</td>
                <td className={`col-num ${cellClass(bpmStatus(row.bpm))}`}>{row.bpm}</td>
                <td className={`col-num ${cellClass(spo2Status(row.spo2))}`}>{row.spo2}%</td>
                <td className={`col-num ${cellClass(tempStatus(row.tempC))}`}>
                  {row.tempC.toFixed(1)}&deg;C
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span className="pagination-info">
          {start + 1}&ndash;{Math.min(start + PAGE_SIZE, ordered.length)} of{' '}
          {ordered.length.toLocaleString()} readings
        </span>
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 0}
          >
            Previous
          </button>
          <span className="page-indicator">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= pageCount - 1}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
