// Turning raw readings into chart series.
//
// The data is bursts: a person holds a finger on the sensor for a few minutes
// (a reading every ~15 s), then nobody uses the Catcher for hours. A line chart
// fed those points naively draws a straight line across the empty hours, which
// invents readings that were never taken. Every function here exists to stop
// that happening.

export const RANGE_SPAN_MS = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };

/** A silence longer than this is a real gap, never a slow sample. */
const MIN_GAP_MS = 60_000;
/** ...and so is any interval this many times the series' own normal spacing. */
const GAP_FACTOR = 4;

const CHART_POINT_TARGET = 200;

/**
 * Decimate to ~200 points. The last row is always kept so the right edge of
 * every chart is the same reading shown on the stat cards.
 */
export function thinRows(rows, target = CHART_POINT_TARGET) {
  if (rows.length <= target) return rows;
  const step = Math.max(1, Math.ceil(rows.length / target));
  const kept = rows.filter((_, i) => i % step === 0);
  if (kept.at(-1) !== rows.at(-1)) kept.push(rows.at(-1));
  return kept;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The gap threshold is derived from the series itself rather than hardcoded,
 * because thinning changes the spacing: at 24h nothing is dropped and points
 * are ~15 s apart, while at 30d one row in ten survives and points inside a
 * single burst are minutes apart. A fixed threshold would be wrong at one end
 * or the other.
 *
 * The median is what makes this work — between-burst intervals are hours long
 * but they are a small minority of the intervals, so they cannot drag the
 * median far enough to be mistaken for normal spacing.
 */
function gapThreshold(times) {
  const deltas = [];
  for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
  return Math.max(MIN_GAP_MS, median(deltas) * GAP_FACTOR);
}

/**
 * Build one metric's series from thinned rows.
 *
 * Returns Chart.js {x, y} points with an explicit `{y: null}` inserted wherever
 * the Catcher was silent. With spanGaps left off, a null breaks the line, so the
 * chart shows one segment per recording session and empty space in between.
 *
 * A session that survives thinning as a single point would draw no line at all
 * and be invisible, so `radii` marks those points to be drawn as dots.
 */
export function buildSeries(rows, key) {
  const points = [];
  const radii = [];
  const times = rows.map((r) => new Date(r.recordedAt).getTime());
  const threshold = gapThreshold(times);

  let sessionCount = rows.length ? 1 : 0;
  let sessionStart = 0; // index into `rows` of the current session's first point

  const flushSession = (endExclusive) => {
    // A session of exactly one point has no line to draw — give it a dot.
    if (endExclusive - sessionStart === 1) radii[radii.length - 1] = 3;
  };

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && times[i] - times[i - 1] > threshold) {
      flushSession(i);
      // The break itself. Its x never renders; the midpoint just keeps the
      // x values strictly increasing.
      points.push({ x: (times[i - 1] + times[i]) / 2, y: null });
      radii.push(0);
      sessionStart = i;
      sessionCount++;
    }
    points.push({ x: times[i], y: rows[i][key] });
    radii.push(0);
  }
  flushSession(rows.length);

  return { points, radii, sessionCount };
}

/**
 * X-axis bounds. Pinned to the requested window so a range with only two short
 * bursts in it reads as sparse, instead of those bursts being stretched to fill
 * the chart and looking like continuous monitoring.
 */
export function axisBounds(rows, range) {
  const now = Date.now();
  const span = RANGE_SPAN_MS[range] ?? RANGE_SPAN_MS['24h'];
  if (!rows.length) return { min: now - span, max: now };
  const first = new Date(rows[0].recordedAt).getTime();
  const last = new Date(rows.at(-1).recordedAt).getTime();
  return { min: Math.min(now - span, first), max: Math.max(now, last) };
}
