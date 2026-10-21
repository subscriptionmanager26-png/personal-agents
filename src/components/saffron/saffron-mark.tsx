/** Center hero mark — minimal stigma / horizon glyph. */
export function SaffronMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="40" cy="40" r="38" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <path
        d="M40 18 C52 18 58 26 58 34 C58 42 52 46 40 46 C28 46 22 50 22 58 C22 66 28 74 40 74"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="40" cy="40" r="3" fill="white" fillOpacity="0.9" />
    </svg>
  );
}
