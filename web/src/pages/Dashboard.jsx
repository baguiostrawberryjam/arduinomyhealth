import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, MOCK } from '../api.js';
import { LAYOUT } from '../config.js';
import { METRICS, RANGES } from '../constants.js';
import { buildCsv, csvFilename, downloadCsv, formatDateTime } from '../format.js';
import { thinRows } from '../series.js';
import Brand from '../components/Brand.jsx';
import DeviceStatus from '../components/DeviceStatus.jsx';
import RangeControl from '../components/RangeControl.jsx';
import ReadingsChart from '../components/ReadingsChart.jsx';
import ReadingsTable from '../components/ReadingsTable.jsx';
import StatCard from '../components/StatCard.jsx';
import Tabs from '../components/Tabs.jsx';
import UserCodeCard from '../components/UserCodeCard.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trends', label: 'Trends & Readings' },
];

export default function Dashboard({ me, onLogout }) {
  const [range, setRange] = useState('24h');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('overview');
  // {min, max} in epoch ms while zoomed into part of the range, else null.
  // Held here rather than per chart so all three stay on the same window.
  const [zoom, setZoom] = useState(null);

  // The one fetch. Cards, charts, table and CSV are all derived from `rows`,
  // so there is a single loading state and the four surfaces cannot disagree.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .readings(range)
      .then((data) => {
        if (!cancelled) setRows(data.rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setRows([]);
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  // A zoom window belongs to the range it was drawn on.
  useEffect(() => {
    setZoom(null);
  }, [range, reloadKey]);

  // Contract: rows is ascending, so the newest reading is the last one. The
  // cards always show the latest reading in the range, never the latest inside
  // a zoom window — zooming is for reading the charts, not for redefining
  // "current".
  const latest = rows.at(-1) ?? null;
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? range;

  // Thin from the rows inside the zoom window rather than from the whole range,
  // so zooming in actually reveals detail instead of just magnifying the same
  // ~200 decimated points.
  const zoomedRows = useMemo(() => {
    if (!zoom) return rows;
    return rows.filter((r) => {
      const t = new Date(r.recordedAt).getTime();
      return t >= zoom.min && t <= zoom.max;
    });
  }, [rows, zoom]);

  const chartRows = useMemo(() => thinRows(zoomedRows), [zoomedRows]);

  const handleZoom = useCallback((next) => setZoom(next), []);

  function handleDownload() {
    downloadCsv(buildCsv(rows), csvFilename(range));
  }

  const tabbed = LAYOUT === 'tabs';
  const showOverview = !tabbed || tab === 'overview';
  const showTrends = !tabbed || tab === 'trends';

  const overviewSections = (
    <>
      <section className="section section-first" aria-labelledby="latest-heading">
        <div className="section-head">
          <div>
            <h2 className="section-title" id="latest-heading">
              Latest reading
            </h2>
            <p className="section-sub">
              The most recent measurement in the last {rangeLabel}, against the same limits the
              Catcher Device uses.
            </p>
          </div>
        </div>
        <div className="stat-grid">
          {METRICS.map((metric) => (
            <StatCard key={metric.key} metric={metric} reading={latest} loading={loading} />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="device-heading">
        <div className="section-head">
          <h2 className="section-title" id="device-heading">
            Using the Catcher Device
          </h2>
        </div>
        <UserCodeCard userCode={me.userCode} deviceOnline={me.deviceOnline} />
      </section>
    </>
  );

  const trendsSections = (
    <>
      <section className="section section-first" aria-labelledby="trends-heading">
        <div className="section-head">
          <div>
            <h2 className="section-title" id="trends-heading">
              Trends
            </h2>
            <p className="section-sub">
              {zoom
                ? `Zoomed to ${formatDateTime(new Date(zoom.min).toISOString())} – ${formatDateTime(
                    new Date(zoom.max).toISOString()
                  )}.`
                : 'Readings from health-monitoring sessions are depicted as points in the chart. Drag across a chart to zoom to a specific session.'}
            </p>
          </div>
          {zoom && (
            <button type="button" className="btn btn-secondary" onClick={() => setZoom(null)}>
              Reset zoom
            </button>
          )}
        </div>
        <div className="chart-grid">
          {METRICS.map((metric) => (
            <ReadingsChart
              key={metric.key}
              metric={metric}
              chartRows={chartRows}
              totalCount={zoomedRows.length}
              range={range}
              loading={loading}
              zoom={zoom}
              onZoom={handleZoom}
            />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="table-heading">
        <div className="section-head">
          <div>
            <h2 className="section-title" id="table-heading">
              All readings
            </h2>
            <p className="section-sub">Latest readings at your grasp.</p>
          </div>
        </div>
        <ReadingsTable rows={rows} loading={loading} />
      </section>
    </>
  );

  return (
    <div className="shell">
      {MOCK && (
        <div className="mock-banner">
          Demo mode — showing generated sample data. No backend is connected yet.
        </div>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <div className="topbar-right">
            <span className="topbar-user">{me.name}</span>
            <button type="button" className="btn btn-ghost" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        <div className="page-head">
          <div>
            <h1 className="page-title">Your readings</h1>
            <div className="head-meta">
              <DeviceStatus online={me.deviceOnline} lastSeenAt={me.deviceLastSeenAt} />
              <span className="page-sub">Last {rangeLabel}</span>
            </div>
          </div>
          <div className="head-actions">
            <RangeControl value={range} onChange={setRange} disabled={loading} />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDownload}
              disabled={loading || rows.length === 0}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
              </svg>
              Download CSV
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="linkbtn"
              onClick={() => setReloadKey((k) => k + 1)}
              style={{ color: 'inherit' }}
            >
              Try again
            </button>
          </div>
        )}

        {tabbed && <Tabs tabs={TABS} value={tab} onChange={setTab} />}

        {showOverview && (
          <div
            id={tabbed ? 'panel-overview' : undefined}
            role={tabbed ? 'tabpanel' : undefined}
            aria-labelledby={tabbed ? 'tab-overview' : undefined}
            tabIndex={tabbed ? 0 : undefined}
            className="tab-panel"
          >
            {overviewSections}
          </div>
        )}

        {showTrends && (
          <div
            id={tabbed ? 'panel-trends' : undefined}
            role={tabbed ? 'tabpanel' : undefined}
            aria-labelledby={tabbed ? 'tab-trends' : undefined}
            tabIndex={tabbed ? 0 : undefined}
            className="tab-panel"
          >
            {trendsSections}
          </div>
        )}
      </main>
    </div>
  );
}
