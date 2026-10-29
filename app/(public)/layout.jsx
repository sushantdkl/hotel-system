import localFont from 'next/font/local';
import PublicShell from '@/components/public/public-shell';
import { getPublicBrand, getPublicContact, getPublicSeo } from '@/lib/public-content';
import './premium.css';

// Self-hosted (next/font/google crashed builds whenever Google answered with
// extensionless URLs). Latin and Devanagari are separate families so each
// script only downloads when a page actually uses it.
const body = localFont({
  src: [
    { path: './fonts/mukta-400-latin.woff2', weight: '400' },
    { path: './fonts/mukta-500-latin.woff2', weight: '500' },
    { path: './fonts/mukta-600-latin.woff2', weight: '600' },
    { path: './fonts/mukta-700-latin.woff2', weight: '700' },
  ],
  variable: '--font-mukta',
  display: 'swap',
});

const bodyDeva = localFont({
  src: [
    { path: './fonts/mukta-400-deva.woff2', weight: '400' },
    { path: './fonts/mukta-600-deva.woff2', weight: '600' },
  ],
  variable: '--font-mukta-deva',
  display: 'swap',
  preload: false,
});

// Sign-painter Devanagari for Nepali headlines.
const nepali = localFont({
  src: './fonts/yatra-one-deva.woff2',
  weight: '400',
  variable: '--font-yatra',
  display: 'swap',
});

// CMS edits (phone, WhatsApp, logo, colours…) must show without a rebuild.
export const dynamic = 'force-dynamic';

/** Titles, description, share image and favicon all come from the CMS (Brand + SEO tabs). */
export async function generateMetadata() {
  const [brand, seo] = await Promise.all([getPublicBrand(), getPublicSeo()]);
  const title = seo.title || `${brand.name} | ${brand.tagline}`;
  return {
    title: { default: title, template: `%s | ${brand.name}` },
    description: seo.description,
    applicationName: brand.name,
    ...(seo.canonical ? { alternates: { canonical: seo.canonical } } : {}),
    icons: { icon: brand.favicon, apple: brand.favicon, shortcut: brand.favicon },
    openGraph: { type: 'website', siteName: brand.name, title, description: seo.description, images: [{ url: seo.ogImage, alt: brand.name }] },
    twitter: { card: 'summary_large_image', title, description: seo.description, images: [seo.ogImage] },
  };
}

export default async function PublicLayout({ children }) {
  const [brand, contact] = await Promise.all([getPublicBrand(), getPublicContact()]);
  return (
    <div
      className={`dsp-site ${body.variable} ${bodyDeva.variable} ${nepali.variable}`}
      data-theme={brand.theme}
      style={{
        ['--font-body']: 'var(--font-mukta), var(--font-mukta-deva), ui-sans-serif, system-ui, sans-serif',
        ['--font-nepali']: 'var(--font-yatra), var(--font-mukta-deva), "Nirmala UI", sans-serif',
      }}
    >
      <PublicShell brand={brand} contact={contact}>{children}</PublicShell>
    </div>
  );
}
