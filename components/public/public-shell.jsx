'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Lock, Mail, MapPin, Menu, MessageCircle, Phone, UtensilsCrossed, X } from 'lucide-react';

/**
 * Public site frame: header, mobile sheet, mobile thumb bar and footer.
 * Everything shown here (name, logo, phone, WhatsApp, hours, socials) comes
 * from the CMS Brand tab via the layout.
 */

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/menu', label: 'Menu' },
  { href: '/about', label: 'About' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/contact', label: 'Contact' },
];

const isActive = (pathname, href) => (href === '/' ? pathname === '/' : pathname === href || pathname?.startsWith(`${href}/`));

export default function PublicShell({ brand, contact, children }) {
  const { tel, whatsapp, directions, mailto } = contact.hrefs;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);

  // A navigation closes the sheet; adjusted during render so it never paints over the next page.
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const year = new Date().getFullYear();
  const external = { target: '_blank', rel: 'noopener noreferrer' };

  return (
    <div className="rc-frame">
      <a href="#main" className="rc-skip dsp-focus">Skip to content</a>

      <header className="rc-nav">
        <div className="rc-wrap rc-nav-row">
          <Link href="/" className="rc-brand dsp-focus" aria-label={`${brand.name} home`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo} alt="" width={40} height={40} />
            <span>{brand.shortName}</span>
          </Link>

          <nav className="rc-nav-links" aria-label="Primary">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="dsp-focus" aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="rc-nav-actions">
            <a href={tel} className="rc-btn rc-btn--ghost dsp-focus"><Phone aria-hidden="true" />Call</a>
            <Link href="/menu" className="rc-btn rc-btn--wall dsp-focus"><UtensilsCrossed aria-hidden="true" />Order</Link>
          </div>

          <button
            ref={toggleRef}
            type="button"
            className="rc-nav-toggle dsp-focus"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="site-sheet"
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>

        {open ? (
          <div className="rc-nav-sheet" id="site-sheet">
            <div className="rc-wrap">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rc-sheet-link dsp-focus" aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
                  {item.label}
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              ))}
              <div className="rc-sheet-actions">
                <a href={tel} className="rc-btn rc-btn--ghost dsp-focus"><Phone aria-hidden="true" />Call</a>
                <a href={whatsapp} {...external} className="rc-btn rc-btn--wall dsp-focus"><MessageCircle aria-hidden="true" />WhatsApp</a>
              </div>
              {brand.hours.length ? <div className="rc-sheet-hours">{brand.hours.map((line) => <p key={line}>{line}</p>)}</div> : null}
            </div>
          </div>
        ) : null}
      </header>

      <main className="rc-main" id="main">{children}</main>

      <footer className="rc-footer">
        <div className="rc-wrap rc-footer-grid">
          <div className="rc-footer-brand">
            <strong>{brand.name}</strong>
            <p>{brand.tagline}</p>
            {brand.hours.length ? <div style={{ marginTop: '1rem' }}>{brand.hours.map((line) => <p key={line}>{line}</p>)}</div> : null}
          </div>
          <nav aria-label="Footer">
            {NAV.map((item) => <Link key={item.href} href={item.href} className="dsp-focus">{item.label}</Link>)}
          </nav>
          <div className="rc-footer-contact">
            <a href={tel} className="dsp-focus"><Phone aria-hidden="true" />{contact.phoneDisplay}</a>
            <a href={whatsapp} {...external} className="dsp-focus"><MessageCircle aria-hidden="true" />WhatsApp</a>
            {contact.email ? <a href={mailto} className="dsp-focus"><Mail aria-hidden="true" />{contact.email}</a> : null}
            <a href={directions} {...external} className="dsp-focus"><MapPin aria-hidden="true" />{contact.location}</a>
            {['facebook', 'instagram', 'tiktok'].map((network) => (contact.social[network] ? (
              <a key={network} href={contact.social[network]} {...external} className="dsp-focus" style={{ textTransform: 'capitalize' }}>
                <ArrowUpRight aria-hidden="true" />{network === 'tiktok' ? 'TikTok' : network}
              </a>
            ) : null))}
          </div>
        </div>
        <div className="rc-wrap rc-footer-bottom">
          <span>© {year} {brand.name}</span>
          <Link href="/login" className="dsp-focus" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', minHeight: 44 }}>
            <Lock aria-hidden="true" style={{ width: '.9rem', height: '.9rem' }} />Staff login
          </Link>
        </div>
      </footer>

      {/* The menu page has its own order button in this spot. */}
      {pathname !== '/menu' ? (
        <nav className="rc-thumbbar" aria-label="Quick actions">
          <a href={tel} className="is-quiet dsp-focus"><Phone aria-hidden="true" />Call</a>
          <a href={whatsapp} {...external} className="is-quiet dsp-focus"><MessageCircle aria-hidden="true" />WhatsApp</a>
          <Link href="/menu" className="is-main dsp-focus"><UtensilsCrossed aria-hidden="true" />Menu</Link>
        </nav>
      ) : null}
    </div>
  );
}
