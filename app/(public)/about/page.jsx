import Link from 'next/link';
import { MapPin, UtensilsCrossed } from 'lucide-react';
import { getPublicAbout, getPublicBrand, getPublicContact } from '@/lib/public-content';
import PageHead from '@/components/public/page-head';
import PaintedEdge from '@/components/public/painted-edge';

export async function generateMetadata() {
  const [about, brand] = await Promise.all([getPublicAbout(), getPublicBrand()]);
  return { title: 'About', description: about.description || `About ${brand.name}.`, alternates: { canonical: '/about' } };
}

export default async function AboutPage() {
  const [about, contact, brand] = await Promise.all([getPublicAbout(), getPublicContact(), getPublicBrand()]);
  if (about.visible === false) {
    return <div className="rc-wrap rc-empty"><h1 className="rc-h2">{brand.name}</h1><p>This page is not available right now.</p></div>;
  }
  const images = about.images.slice(0, 2);

  return (
    <>
      <PageHead title={about.heading} />
      <div className="rc-wrap rc-page-body">
        <div className="rc-about-grid">
          <div className="rc-about-copy">
            <p>{about.description}</p>
            {about.descriptionExtra ? <p>{about.descriptionExtra}</p> : null}
            <div className="rc-hero-actions">
              <Link href="/menu" className="rc-btn rc-btn--wall dsp-focus"><UtensilsCrossed aria-hidden="true" />See the menu</Link>
              <a href={contact.hrefs.directions} target="_blank" rel="noopener noreferrer" className="rc-btn rc-btn--ghost dsp-focus"><MapPin aria-hidden="true" />Get directions</a>
            </div>
          </div>
          {images.length ? (
            <div className="rc-about-media">
              {images.map((src, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${src}-${index}`} src={src} alt={`${brand.name}`} loading={index ? 'lazy' : 'eager'} />
              ))}
            </div>
          ) : null}
        </div>

        {about.features.length ? (
          <div className="rc-features">
            {about.features.map((feature, index) => (
              <div key={`${feature.title}-${index}`} className="rc-feature">
                <h2 className="rc-h3">{feature.title}</h2>
                <p>{feature.text}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <section className="rc-visit rc-section" aria-labelledby="about-visit">
        <PaintedEdge />
        <div className="rc-wrap rc-visit-grid">
          <div>
            <h2 id="about-visit" className="rc-h2">{about.visitHeading}</h2>
            <p style={{ marginTop: '.75rem', color: 'var(--on-wall-muted)' }}>{contact.location}</p>
            {brand.hours.length ? <div style={{ marginTop: '1rem' }}>{brand.hours.map((line) => <p key={line}>{line}</p>)}</div> : null}
            <div className="rc-hero-actions">
              <a href={contact.hrefs.tel} className="rc-btn rc-btn--kamero dsp-focus">Call {contact.phoneDisplay}</a>
            </div>
          </div>
          {contact.mapEmbedSrc ? (
            <div className="rc-map"><iframe src={contact.mapEmbedSrc} title={`Map to ${brand.name}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /></div>
          ) : null}
        </div>
      </section>
    </>
  );
}
