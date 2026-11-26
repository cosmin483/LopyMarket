// Brand mark: a sonar sweep that has just caught one blip.
export default function Mark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeOpacity=".28" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeOpacity=".28" />
      <path d="M16 16 L16 1.5 A14.5 14.5 0 0 1 29.2 10 Z" fill="var(--amber)" fillOpacity=".22" />
      <line x1="16" y1="16" x2="29.2" y2="10" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="22.6" cy="7.4" r="2.4" fill="var(--amber)" />
    </svg>
  );
}
