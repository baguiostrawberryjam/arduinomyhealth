// Dev-time layout switches, in the same spirit as THEME in theme.js.
//
// LAYOUT decides how the dashboard is arranged:
//
//   'tabs'   Overview (latest reading + Catcher guide) and Trends & Readings
//            (charts + table) as two tabs, so neither view needs much scrolling.
//   'single' Everything on one scrolling page, the original layout.
//
// Both paths render from the same sections in Dashboard.jsx — nothing is
// duplicated — so flipping this constant is a complete revert either way.

export const LAYOUT = 'tabs'; // 'tabs' | 'single'
