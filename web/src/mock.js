// Mock fixtures — API Contract v1.
//
// The whole frontend is built against these. When the backend is live, flip
// MOCK to false in api.js; nothing in the pages or components changes, because
// they only ever see the shapes defined in the contract.

export const MOCK_ME = {
  id: 1,
  name: 'Juan Dela Cruz',
  email: 'juan@example.com',
  userCode: '482913',
  deviceOnline: true,
  deviceLastSeenAt: new Date(Date.now() - 4 * 60_000).toISOString(),
};

// Plausible session-shaped data: short bursts of activity, long gaps between.
// This shape is the point. Real data looks like this once invalid readings are
// suppressed, and it is what breaks a chart that interpolates across gaps.
export function mockRows(range = '24h') {
  const spanMs = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6 }[range];
  const now = Date.now();
  const rows = [];
  let id = 1000;
  const sessions = { '24h': 6, '7d': 28, '30d': 90 }[range];

  for (let s = 0; s < sessions; s++) {
    const start = now - spanMs + Math.random() * spanMs;
    const n = 12 + Math.floor(Math.random() * 20); // ~3–8 min at 15s
    const baseBpm = 68 + Math.random() * 25;
    const baseTemp = 36.4 + Math.random() * 1.3;
    for (let i = 0; i < n; i++) {
      rows.push({
        id: id++,
        bpm: Math.round(baseBpm + Math.sin(i / 3) * 4 + Math.random() * 3),
        spo2: Math.min(100, Math.round(96 + Math.random() * 3)),
        tempC: +(baseTemp + Math.random() * 0.2).toFixed(1),
        recordedAt: new Date(start + i * 15_000).toISOString(),
      });
    }
  }
  return rows.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
}
