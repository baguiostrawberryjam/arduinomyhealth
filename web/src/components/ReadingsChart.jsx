import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { axisBounds, buildSeries } from '../series.js';
import { formatAxisTick, formatTimestamp } from '../format.js';
import { readTokens } from '../theme.js';
import MetricIcon from './MetricIcon.jsx';

// Registered once. No CategoryScale and no time scale: the x-axis is plain
// linear over epoch milliseconds, which keeps real elapsed time on the axis
// (a two-hour gap is drawn two hours wide) without pulling in a date adapter.
ChartJS.register(LinearScale, LineElement, PointElement, Filler, Tooltip);

const CHART_TOKENS = [
  'chart-grid',
  'chart-axis',
  'chart-surface',
  'chart-tooltip-bg',
  'chart-tooltip-border',
  'chart-tooltip-title',
  'chart-tooltip-body',
];

const MONO = '"Google Sans Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Below this the drag was a click, so tooltips and taps still work normally. */
const DRAG_THRESHOLD_PX = 8;
/** Never zoom tighter than a minute; past that the axis labels stop meaning anything. */
const MIN_ZOOM_MS = 60_000;

export default function ReadingsChart({
  metric,
  chartRows,
  totalCount,
  range,
  loading,
  zoom,
  onZoom,
}) {
  // Canvas cannot use var(), so the theme's colours are read back out of CSS
  // here. That keeps styles.css the only place a colour is written down, and
  // means switching themes needs no change in this file.
  const theme = useMemo(
    () => readTokens([...CHART_TOKENS, metric.token, `${metric.token}-soft`]),
    [metric.token]
  );
  const line = theme[metric.token];
  const fill = theme[`${metric.token}-soft`];

  const { points, radii, sessionCount } = useMemo(
    () => buildSeries(chartRows, metric.key),
    [chartRows, metric.key]
  );

  // When zoomed, the axis is pinned to the requested window rather than to the
  // data, so an empty stretch inside the selection still reads as empty.
  const bounds = useMemo(
    () => zoom ?? axisBounds(chartRows, range),
    [zoom, chartRows, range]
  );

  const chartRef = useRef(null);
  // {from, to} in canvas pixels while a drag is in progress, else null.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);

  /**
   * Drag-to-zoom, hand-rolled rather than pulled in as a plugin.
   *
   * Listeners go on the canvas itself, not on an overlay, so Chart.js keeps
   * receiving the hover events its tooltips need. The selection rectangle is a
   * sibling div with pointer-events: none.
   */
  const handlePointerDown = useCallback((event) => {
    const chart = chartRef.current;
    if (!chart || event.button !== 0) return;
    const { left, right } = chart.chartArea;
    const x = event.nativeEvent.offsetX;
    if (x < left || x > right) return;
    dragRef.current = { from: x, to: x };
    setDrag({ from: x, to: x });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event) => {
    if (!dragRef.current) return;
    const chart = chartRef.current;
    if (!chart) return;
    const { left, right } = chart.chartArea;
    const x = Math.min(right, Math.max(left, event.nativeEvent.offsetX));
    dragRef.current = { ...dragRef.current, to: x };
    setDrag({ ...dragRef.current });
  }, []);

  const handlePointerUp = useCallback(() => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    const chart = chartRef.current;
    if (!current || !chart) return;

    if (Math.abs(current.to - current.from) < DRAG_THRESHOLD_PX) return; // a click, not a drag

    const scale = chart.scales.x;
    const a = scale.getValueForPixel(Math.min(current.from, current.to));
    const b = scale.getValueForPixel(Math.max(current.from, current.to));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (b - a < MIN_ZOOM_MS) return;

    onZoom?.({ min: a, max: b });
  }, [onZoom]);

  // Pointer capture means the release can land outside the canvas; cancel
  // cleanly if the gesture is interrupted (Esc, or tabbing away mid-drag).
  // Keyed on whether a drag is open, not on the drag itself — `drag` changes on
  // every pointer move, and re-binding listeners at that rate would be wasteful
  // as well as easy to leak.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dragging]);

  const data = useMemo(
    () => ({
      datasets: [
        {
          label: metric.label,
          data: points,
          borderColor: line,
          backgroundColor: fill,
          borderWidth: 2,
          fill: 'start',
          tension: 0.25,
          // The whole reason this chart is trustworthy. buildSeries inserts a
          // null y wherever the Catcher was silent, and spanGaps: false makes
          // Chart.js break the line there instead of drawing a straight line
          // across hours of no readings.
          spanGaps: false,
          pointRadius: radii,
          pointHoverRadius: 4,
          pointHitRadius: 12,
          pointBackgroundColor: line,
          pointBorderColor: theme['chart-surface'],
          pointBorderWidth: 1,
        },
      ],
    }),
    [points, radii, metric.label, line, fill, theme]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // Ranges get switched back and forth; animating 200 points each time is
      // motion without information.
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: bounds.min,
          max: bounds.max,
          grid: { display: false },
          border: { color: theme['chart-grid'] },
          ticks: {
            color: theme['chart-axis'],
            font: { size: 10.5, family: MONO },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (value) => formatAxisTick(value, bounds.max - bounds.min),
          },
        },
        y: {
          suggestedMin: metric.suggested[0],
          suggestedMax: metric.suggested[1],
          grid: { color: theme['chart-grid'], drawTicks: false },
          border: { display: false },
          ticks: {
            color: theme['chart-axis'],
            font: { size: 10.5, family: MONO },
            maxTicksLimit: 5,
            padding: 8,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !drag, // a tooltip mid-drag just gets in the way
          displayColors: false,
          backgroundColor: theme['chart-tooltip-bg'],
          borderColor: theme['chart-tooltip-border'],
          borderWidth: 1,
          titleColor: theme['chart-tooltip-title'],
          bodyColor: theme['chart-tooltip-body'],
          padding: 10,
          cornerRadius: 6,
          titleFont: { size: 10.5, weight: '400', family: MONO },
          bodyFont: { size: 13, weight: '700' },
          callbacks: {
            title: (items) => formatTimestamp(new Date(items[0].parsed.x).toISOString()),
            label: (item) => `${metric.format(item.parsed.y)} ${metric.unit}`,
          },
        },
      },
    }),
    [bounds, metric, range, theme, drag, zoom]
  );

  const selection = drag && {
    left: Math.min(drag.from, drag.to),
    width: Math.abs(drag.to - drag.from),
  };

  return (
    <div className="card chart-card" data-metric={metric.key}>
      <div className="chart-head">
        <h3 className="chart-title">
          <span className="chart-icon">
            <MetricIcon name={metric.key} size={16} />
          </span>
          {metric.label}
          <span className="chart-unit">{metric.unit}</span>
        </h3>
        {!loading && chartRows.length > 0 && (
          <span className="chart-meta">
            {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
            {totalCount > chartRows.length
              ? ` · ${chartRows.length} of ${totalCount.toLocaleString()} readings shown`
              : ` · ${totalCount.toLocaleString()} readings`}
          </span>
        )}
      </div>

      <div className="chart-canvas">
        {loading ? (
          <div className="skeleton" style={{ width: '100%', height: '100%' }} />
        ) : chartRows.length === 0 ? (
          <div className="empty" style={{ padding: '52px 16px' }}>
            <p className="empty-body">
              {zoom
                ? 'No readings in the selected window.'
                : `No ${metric.label.toLowerCase()} readings in this period.`}
            </p>
          </div>
        ) : (
          <>
            <Line
              ref={chartRef}
              data={data}
              options={options}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={() => onZoom?.(null)}
            />
            {selection && selection.width > 1 && (
              <span
                className="chart-selection"
                style={{ left: selection.left, width: selection.width }}
                aria-hidden="true"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
