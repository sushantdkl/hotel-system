/**
 * The hand-painted line where white clay meets red clay on a hill-house wall.
 * Uneven on purpose: it is brushed, not ruled. Fills with the current colour
 * (the theme's wall colour via CSS).
 */
export default function PaintedEdge({ className = '' }) {
  return (
    <svg className={`rc-edge ${className}`} viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 24V11c48-3 92 3 151 0s102-6 163-2 96 7 158 3 117-8 176-4 88 7 149 4 121-7 182-3 79 6 125 2 70-3 96-1V24Z" />
    </svg>
  );
}
