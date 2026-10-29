import { ArrowUpRight, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { getPublicBrand, getPublicContact } from '@/lib/public-content';
import ContactForm from '@/components/public/contact-form';
import PageHead from '@/components/public/page-head';

export async function generateMetadata() {
  const [contact, brand] = await Promise.all([getPublicContact(), getPublicBrand()]);
  return {
    title: 'Contact',
    description: `Contact ${brand.name}. Call ${contact.phoneDisplay} or message on WhatsApp.`,
    alternates: { canonical: '/contact' },
  };
}

export default async function ContactPage() {
  const [info, brand] = await Promise.all([getPublicContact(), getPublicBrand()]);
  const rows = [
    { icon: Phone, label: 'Phone', value: info.phoneDisplay, href: info.hrefs.tel },
    { icon: MessageCircle, label: 'WhatsApp', value: 'Message us to order or ask a question', href: info.hrefs.whatsapp, external: true },
    info.email ? { icon: Mail, label: 'Email', value: info.email, href: info.hrefs.mailto } : null,
    { icon: MapPin, label: 'Address', value: info.location, href: info.hrefs.directions, external: true },
  ].filter(Boolean);

  return (
    <>
      <PageHead title={info.pageHeading} lead={info.intro} />
      <div className="rc-wrap rc-page-body">
        <div className="rc-contact-grid">
          <div>
            <div className="rc-rows">
              {rows.map((row) => (
                <a key={row.label} href={row.href} target={row.external ? '_blank' : undefined} rel={row.external ? 'noopener noreferrer' : undefined} className="rc-row dsp-focus">
                  <row.icon aria-hidden="true" />
                  <span><strong>{row.label}</strong><span>{row.value}</span></span>
                  <ArrowUpRight className="rc-row-go" aria-hidden="true" />
                </a>
              ))}
            </div>
            {brand.hours.length ? (
              <div className="rc-hours">
                <h2>Opening hours</h2>
                {brand.hours.map((line) => <p key={line}>{line}</p>)}
              </div>
            ) : null}
            <h2 className="rc-h3" style={{ marginTop: '3rem', fontSize: '1.4rem' }}>{info.formHeading}</h2>
            <ContactForm />
          </div>
          <section className="rc-contact-map" aria-label="Map">
            {info.mapEmbedSrc ? (
              <iframe src={info.mapEmbedSrc} title={`Map to ${brand.name}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
            ) : (
              <div className="rc-empty"><p>{info.location}</p></div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
