// Theme switching.
//
// Both palettes live in styles.css as custom properties, selected by a
// data-theme attribute on <html>. Nothing else in the app knows a colour value,
// so switching themes is this one constant — including the charts, which read
// their colours back out of CSS at render time.
//
//   THEME = 'light'  ->  light palette
//   THEME = 'dark'   ->  dark palette
//
// For a quick look without an edit, append ?theme=dark (or ?theme=light) to the
// URL; that overrides the constant for that page load only.

export const THEME = 'light'; // 'light' | 'dark'

export function resolveTheme() {
  const requested = new URLSearchParams(window.location.search).get('theme');
  return requested === 'light' || requested === 'dark' ? requested : THEME;
}

export function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme();
}

/**
 * Read CSS custom properties back as concrete values.
 *
 * Canvas cannot use var(), so the charts have to resolve their colours in JS.
 * Reading them from the stylesheet rather than duplicating hex codes here is
 * what keeps a theme switch from needing a second edit.
 */
export function readTokens(names) {
  const styles = getComputedStyle(document.documentElement);
  const out = {};
  for (const name of names) out[name] = styles.getPropertyValue(`--${name}`).trim();
  return out;
}
