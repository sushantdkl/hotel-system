'use client';

import { useState } from 'react';

/**
 * Public menu image. Reserves its box (no layout shift), lazy-loads natively,
 * and shows a named plate on the wall colour when a dish has no photo or the
 * photo fails — never a blank panel.
 */
export default function DishImage({ src, alt, className = '', rounded = 'rounded-xl' }) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <div className={`relative overflow-hidden ${rounded} ${className}`} style={{ background: 'var(--dsp-border)', flex: 'none' }}>
      {showFallback ? (
        <div className="rc-dish-fallback absolute inset-0">
          <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="32" cy="32" r="13" stroke="currentColor" strokeWidth="2" opacity=".6" />
          </svg>
          <span className="line-clamp-2">{alt}</span>
        </div>
      ) : (
        // A photo that failed before hydration never fires onError; the ref catches it.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={(img) => { if (img?.complete && img.naturalWidth === 0) setFailed(true); }} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}
