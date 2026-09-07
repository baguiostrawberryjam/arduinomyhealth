// Timestamp and CSV formatting. No date library — Intl does all of this.
// Readings are stored in UTC and always displayed in Manila local time, so the
// displayed time matches the clock on the wall next to the Catcher Device.

const TZ = { timeZone: 'Asia/Manila' };
const LOCALE = 'en-PH';

/** Full date and time, e.g. "05/09/2026, 6:00:12 am". Table and CSV. */
export function formatTimestamp(iso) {
  return new Date(iso).toLocaleString(LOCALE, TZ);
}

/** Date and time without seconds. Tooltips and "last seen". */
export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(LOCALE, {
    ...TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Chart axis tick, chosen from how much time is actually on screen rather than
 * from the selected range — the axis is zoomable, so a 30-day chart dragged
 * down to twenty minutes needs clock labels, not three copies of the same date.
 */
export function formatAxisTick(ms, spanMs) {
  const d = new Date(ms);
  if (spanMs <= 6 * 3600e3) {
    return d.toLocaleString(LOCALE, { ...TZ, hour: 'numeric', minute: '2-digit' });
  }
  if (spanMs <= 3 * 864e5) {
    return d.toLocaleString(LOCALE, { ...TZ, day: '2-digit', month: 'short', hour: 'numeric' });
  }
  return d.toLocaleString(LOCALE, { ...TZ, day: '2-digit', month: 'short' });
}

/** Manila calendar day, used to group the table into day sections. */
export function manilaDayKey(iso) {
  return new Date(iso).toLocaleDateString('en-CA', TZ); // YYYY-MM-DD, sorts naturally
}

export function formatDayHeading(iso) {
  return new Date(iso).toLocaleDateString(LOCALE, {
    ...TZ,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** RFC-4180 field: quote anything containing a comma, quote, or newline. */
function csvField(value) {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the CSV in the browser from rows already in memory — no endpoint.
 * The Manila timestamp contains a comma, so every field goes through csvField.
 */
export function buildCsv(rows) {
  const header = ['Date', 'Heart Rate (BPM)', 'SpO2 (%)', 'Temperature (C)'];
  return [header.join(',')]
    .concat(
      rows.map((r) =>
        [formatTimestamp(r.recordedAt), r.bpm, r.spo2, r.tempC].map(csvField).join(',')
      )
    )
    .join('\r\n');
}

/** Trigger a download of `text` as `filename`. */
export function downloadCsv(text, filename) {
  // The BOM makes Excel open UTF-8 correctly on Windows.
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `userCode` is only passed from the admin view, so downloads stay apart. */
export function csvFilename(range, userCode) {
  const stamp = new Date().toLocaleDateString('en-CA', TZ);
  const who = userCode ? `-${userCode}` : '';
  return `health-readings${who}-${range}-${stamp}.csv`;
}
