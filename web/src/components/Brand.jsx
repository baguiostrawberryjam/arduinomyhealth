export default function Brand({ label = 'ArduinoMyHealth' }) {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h4l2.5-7 4.5 14 3-7h6" />
        </svg>
      </span>
      <span>{label}</span>
    </div>
  );
}
