// Shared constants — identical in firmware, backend, and frontend.
// API Contract v1. Do not diverge; the Catcher Device shows the same warnings.
export const TEMP_HIGH = 37.5; // °C
export const BPM_LOW = 60;
export const BPM_HIGH = 100;
export const SPO2_LOW = 95; // %

export const bpmStatus = (v) => (v < BPM_LOW ? 'low' : v > BPM_HIGH ? 'high' : 'normal');
export const spo2Status = (v) => (v < SPO2_LOW ? 'low' : 'normal');
export const tempStatus = (v) => (v > TEMP_HIGH ? 'high' : 'normal');

export const STATUS_LABEL = { normal: 'Normal', low: 'Low', high: 'High' };

// One metric per card. Colours are not listed here: each metric names the CSS
// custom property that holds its hue, so the light and dark palettes both live
// in styles.css and a theme switch needs no change in this file.
export const METRICS = [
  {
    key: 'bpm',
    label: 'Heart Rate',
    unit: 'BPM',
    token: 'metric-bpm',
    status: bpmStatus,
    format: (v) => String(Math.round(v)),
    normalRange: `${BPM_LOW}–${BPM_HIGH} BPM`,
    // Charts read better with a floor than with a fully auto axis, but the axis
    // must still expand for out-of-range readings rather than clipping them.
    suggested: [50, 110],
  },
  {
    key: 'spo2',
    label: 'Blood Oxygen',
    unit: '%',
    token: 'metric-spo2',
    status: spo2Status,
    format: (v) => String(Math.round(v)),
    normalRange: `${SPO2_LOW}% and above`,
    suggested: [90, 100],
  },
  {
    key: 'tempC',
    label: 'Temperature',
    unit: '°C',
    token: 'metric-tempC',
    status: tempStatus,
    format: (v) => v.toFixed(1),
    normalRange: `Up to ${TEMP_HIGH}°C`,
    suggested: [35.5, 38],
  },
];

export const RANGES = [
  { key: '24h', label: '24 hours', short: '24h' },
  { key: '7d', label: '7 days', short: '7d' },
  { key: '30d', label: '30 days', short: '30d' },
];
