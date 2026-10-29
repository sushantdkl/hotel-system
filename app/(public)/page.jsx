import Link from 'next/link';
import { Clock, MapPin, MessageCircle, Phone, UtensilsCrossed } from 'lucide-react';
import {
  getPublicBrand, getPublicContact, getPublicFestive, getPublicGallery, getPublicHome,
} from '@/lib/public-content';
import { getPublicMenuCategories } from '@/lib/public-menu';
import { formatMenuPrice } from '@/lib/menu-format.js';
import PaintedEdge from '@/components/public/painted-edge';
import { RestaurantSchema } from '@/components/public/structured-data';

export const dynamic = 'force-dynamic';
export const metadata = { alternates: { canonical: '/' } };

const DEVANAGARI = /[ऀ-ॿ]/;

/** CMS link value → a safe href ("whatsapp" and "tel" are shortcuts). */
function hrefFor(value, contact) {
  if (value === 'whatsapp') return contact.hrefs.whatsapp;
  if (value === 'tel') return contact.hrefs.tel;
  return /^(\/|https?:\/\/|tel:|mailto:)/.test(value || '') ? value : '/menu';
}

function Action({ href, className, children }) {
  if (/^(https?:|tel:|mailto:)/.test(href)) {
    const external = href.startsWith('http');
    return <a href={href} className={className} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{children}</a>;
  }
  return <Link href={href} className={className}>{children}</Link>;
}

export default async function HomePage() {
  const [home, contact, brand] = await Promise.all([getPublicHome(), getPublicContact(), getPublicBrand()]);
  const [categories, gallery, festive] = await Promise.all([
    getPublicMenuCategories().catch(() => []),
    getPublicGallery().catch(() => ({ items: [] })),
    getPublicFestive().catch(() => ({ items: [] })),
  ]);
  const sections = home.sections;

  // A taste of the live menu: two dishes from each category, so the board is varied.
  const board = categories.flatMap((c) => c.items.slice(0, 2).map((item) => ({ ...item, category: c.title }))).slice(0, 10);
  // A CMS category tile links straight to that category on the menu when the names match.
  const categorySlug = new Map(categories.map((c) => [c.title.trim().toLowerCase(), c.id]));
  const tileHref = (tile) => {
    const slug = categorySlug.get(tile.title.trim().toLowerCase());
    return slug && (!tile.href || tile.href === '/menu') ? `/menu?c=${encodeURIComponent(slug)}` : hrefFor(tile.href, contact);
  };
  const headingLines = [home.heroHeadingLine1, home.heroHeadingLine2, home.heroHeadingLine3].filter(Boolean);

  return (
    <>
      <RestaurantSchema contact={contact} brand={brand} />

      {sections.hero && (
        <section className="rc-hero" aria-labelledby="hero-title">
          <div className="rc-wrap rc-hero-top">
            <h1 id="hero-title" className="rc-hero-title">
              {headingLines.map((line) => (DEVANAGARI.test(line)
                ? <span key={line} className="rc-ne" lang="ne">{line}</span>
                : <span key={line} className="rc-en">{line}</span>))}
            </h1>
          </div>
          <div className="rc-hero-wall">
            <PaintedEdge />
            <div className="rc-plate">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={home.heroImage} alt={home.heroImageAlt} fetchPriority="high" />
            </div>
            <div className="rc-wrap rc-hero-body">
              <p className="rc-hero-desc">{home.heroDescription}</p>
              <div className="rc-hero-actions">
                <Action href={hrefFor(home.primaryCta.href, contact)} className="rc-btn rc-btn--kamero dsp-focus">
                  <UtensilsCrossed aria-hidden="true" />{home.primaryCta.label}
                </Action>
                {home.secondaryCta.label ? (
                  <Action href={hrefFor(home.secondaryCta.href, contact)} className="rc-btn rc-btn--ghost-light dsp-focus">
                    <MessageCircle aria-hidden="true" />{home.secondaryCta.label}
                  </Action>
                ) : null}
              </div>
              <div className="rc-hero-facts">
                {home.heroBadgeValue ? <span><strong>{home.heroBadgeValue}</strong> {home.heroBadgeLabel}</span> : null}
                {brand.hours[0] ? <span>{brand.hours[0]}</span> : <span>{contact.location}</span>}
              </div>
            </div>
          </div>
        </section>
      )}

      {festive.items.length ? (
        <section className="rc-festive" aria-label={festive.heading}>
          <div className="rc-wrap">
            <div className="rc-festive-row">
              {festive.items.map((item, index) => {
                const copy = item.eyebrow || item.title || item.linkLabel;
                const inner = (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.image} alt={item.alt || item.title || festive.heading} loading={index ? 'lazy' : 'eager'} />
                    {copy ? (
                      <span className="rc-banner-copy">
                        {item.eyebrow ? <small>{item.eyebrow}</small> : null}
                        {item.title ? <strong>{item.title}</strong> : null}
                        {item.linkLabel && item.href ? <span>{item.linkLabel}</span> : null}
                      </span>
                    ) : null}
                  </>
                );
                const href = item.href ? hrefFor(item.href, contact) : null;
                return href && item.href
                  ? <Action key={item.id || index} href={href} className="rc-banner dsp-focus">{inner}</Action>
                  : <div key={item.id || index} className="rc-banner">{inner}</div>;
              })}
            </div>
          </div>
        </section>
      ) : null}

      {sections.about && (
        <section className="rc-story rc-section">
          <div className="rc-wrap">
            <div className="rc-story-grid">
              <div className="rc-story-media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={home.aboutStripImage} alt={home.aboutStripImageAlt} loading="lazy" />
                {home.heroInsetImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="rc-story-katori" src={home.heroInsetImage} alt={home.heroInsetAlt} loading="lazy" />
                ) : null}
              </div>
              <div>
                <h2 className="rc-h2">{home.aboutStripTitle}</h2>
                <p className="rc-story-text">{home.aboutStripText}</p>
                <Link href={home.aboutStripCtaHref} className="rc-link rc-link--light dsp-focus" style={{ marginTop: '1rem' }}>{home.aboutStripCtaLabel}</Link>
              </div>
            </div>
            {sections.howItWorks && home.howItWorksSteps.length ? (
              <div className="rc-notes">
                {home.howItWorksSteps.map((step) => (
                  <div key={step.title} className="rc-note">
                    <h3 className="rc-h3">{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      )}

      {sections.signature && home.signatureItems.length ? (
        <section className="rc-section">
          <div className="rc-wrap">
            <div className="rc-section-head">
              <div>
                <h2 className="rc-h2">{home.signatureTitle}</h2>
                {home.signatureLead ? <p className="rc-lead">{home.signatureLead}</p> : null}
              </div>
              <Link href="/menu" className="rc-link dsp-focus">See the full menu</Link>
            </div>
            <div className="rc-dish-row">
              {home.signatureItems.map((item, index) => (
                <Link key={`${item.name}-${index}`} href={hrefFor(item.href, contact)} className="rc-dish dsp-focus">
                  <div className="rc-dish-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {item.img ? <img src={item.img} alt="" loading="lazy" /> : null}
                  </div>
                  <h3 className="rc-h3">{item.name}</h3>
                  {item.category ? <p>{item.category}</p> : null}
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {(sections.popular && home.popularCategories.length) || (sections.menu && board.length) ? (
        <section className="rc-kitchen rc-section">
          <div className="rc-wrap">
            <div className="rc-section-head">
              <div>
                <h2 className="rc-h2">{sections.menu && board.length ? home.menuTitle : home.popularTitle}</h2>
                <p className="rc-lead">{sections.menu && board.length ? home.menuLead : home.popularLead}</p>
              </div>
              {sections.menu ? <Link href={hrefFor(home.menuCtaHref, contact)} className="rc-btn rc-btn--wall dsp-focus">{home.menuCtaLabel}</Link> : null}
            </div>
            {sections.popular && home.popularCategories.length ? (
              <nav className="rc-cats" aria-label={home.popularTitle}>
                {home.popularCategories.map((tile) => (
                  <Link key={tile.title} href={tileHref(tile)} className="rc-cat dsp-focus">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {tile.img ? <img src={tile.img} alt="" loading="lazy" /> : <i aria-hidden="true" />}
                    <span><strong>{tile.title}</strong>{tile.note ? <small>{tile.note}</small> : null}</span>
                  </Link>
                ))}
              </nav>
            ) : null}
            {sections.menu && board.length ? (
              <div className="rc-board">
                {board.map((item) => (
                  <div key={item.id} className="rc-board-item">
                    <h3>{item.name}<small>{item.category}</small></h3>
                    <i aria-hidden="true" />
                    <strong>{item.variants?.length ? `from ${formatMenuPrice(Math.min(...item.variants.map((v) => v.price)))}` : formatMenuPrice(item.price)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {sections.gallery && gallery.items.length ? (
        <section className="rc-section">
          <div className="rc-wrap">
            <div className="rc-section-head">
              <h2 className="rc-h2">{home.galleryTitle}</h2>
              <Link href={home.galleryCtaHref} className="rc-link dsp-focus">{home.galleryCtaLabel}</Link>
            </div>
            <div className="rc-mosaic">
              {gallery.items.slice(0, Math.min(home.galleryLimit, 5)).map((item, index) => (
                <figure key={`${item.url}-${index}`} style={{ margin: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.alt} loading="lazy" />
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {sections.findUs && (
        <section className="rc-visit rc-section" aria-labelledby="visit-title">
          <PaintedEdge />
          <div className="rc-wrap rc-visit-grid">
            <div>
              <h2 id="visit-title" className="rc-h2">{home.findUsTitle}</h2>
              {home.findUsLead ? <p style={{ marginTop: '.75rem', maxWidth: '46ch', color: 'var(--on-wall-muted)' }}>{home.findUsLead}</p> : null}
              <ul className="rc-visit-list">
                <li><MapPin aria-hidden="true" /><span><span className="k">Address</span><a href={contact.hrefs.directions} target="_blank" rel="noopener noreferrer" className="v dsp-focus">{contact.location}</a></span></li>
                <li><Phone aria-hidden="true" /><span><span className="k">Phone</span><a href={contact.hrefs.tel} className="v dsp-focus">{contact.phoneDisplay}</a></span></li>
                {brand.hours.length ? <li><Clock aria-hidden="true" /><span><span className="k">Hours</span>{brand.hours.map((line) => <span key={line} className="v">{line}</span>)}</span></li> : null}
              </ul>
              <div className="rc-hero-actions">
                <a href={contact.hrefs.directions} target="_blank" rel="noopener noreferrer" className="rc-btn rc-btn--kamero dsp-focus"><MapPin aria-hidden="true" />Get directions</a>
                <a href={contact.hrefs.whatsapp} target="_blank" rel="noopener noreferrer" className="rc-btn rc-btn--ghost-light dsp-focus"><MessageCircle aria-hidden="true" />WhatsApp</a>
              </div>
            </div>
            {contact.mapEmbedSrc ? (
              <div className="rc-map">
                <iframe src={contact.mapEmbedSrc} title={`Map to ${brand.name}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
              </div>
            ) : null}
          </div>
        </section>
      )}
    </>
  );
}
