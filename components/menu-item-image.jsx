'use client';

import { toPublicImageUrl } from '@/lib/public-image-url.js';

/**
 * Shared food image for waiter / kitchen / admin / cashier.
 * Falls back to a simple plate placeholder when no image_url.
 */
export default function MenuItemImage({
  src,
  alt = 'Food',
  className = '',
  size = 'md',
}) {
  const sizes = {
    sm: 'w-10 h-10',
    thumb: 'w-14 h-14',
    md: 'w-16 h-16',
    lg: 'w-full h-36',
    card: 'w-full h-full',
  };

  const box = `${sizes[size] || sizes.md} ${className} rounded-lg overflow-hidden bg-stone-100 flex-shrink-0`;
  const resolved = toPublicImageUrl(src);

  if (!resolved) {
    return (
      <div className={`${box} flex items-center justify-center text-stone-400`} aria-hidden>
        <svg viewBox="0 0 64 64" className="w-1/2 h-1/2 opacity-70" fill="none">
          <ellipse cx="32" cy="42" rx="22" ry="6" stroke="currentColor" strokeWidth="2" />
          <path d="M12 40c2-14 12-22 20-22s18 8 20 22" stroke="currentColor" strokeWidth="2" />
          <circle cx="32" cy="28" r="3" fill="currentColor" opacity="0.35" />
        </svg>
      </div>
    );
  }

  return (
    <div className={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={alt}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          if (e.currentTarget.parentElement) {
            e.currentTarget.parentElement.classList.add('menu-img-fallback');
          }
        }}
      />
    </div>
  );
}
