/**
 * Tab bar following the ARIA tabs pattern: arrow keys move between tabs, and
 * each panel is labelled by its tab. Only the selected panel is rendered, which
 * is the point — it keeps each view to roughly one screen.
 */
export default function Tabs({ tabs, value, onChange }) {
  function handleKeyDown(event) {
    const index = tabs.findIndex((t) => t.key === value);
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].key);
    document.getElementById(`tab-${tabs[next].key}`)?.focus();
  }

  return (
    <div className="tabs" role="tablist" aria-label="Dashboard sections" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
            {tab.badge != null && <span className="tab-badge">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
