import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm'
import { RESTAURANT } from '@/lib/restaurant-info.js'
import { CalendarSystemProvider } from '@/lib/calendar-context.jsx'

const SITE_DESCRIPTION = `${RESTAURANT.tagline}.` // no phone: it is CMS-managed and this is static

// Bump `v` whenever the favicon assets change to bust browser/CDN caches.
const ICON_VERSION = '2085'

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl),
  title: {
    default: `${RESTAURANT.name} | ${RESTAURANT.tagline}`,
    template: `%s | ${RESTAURANT.name}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: RESTAURANT.name,
  manifest: `/site.webmanifest?v=${ICON_VERSION}`,
  icons: {
    icon: [{ url: `/images/brand/raithane-logo.jpeg?v=${ICON_VERSION}`, type: 'image/jpeg' }],
    apple: [{ url: `/images/brand/raithane-logo.jpeg?v=${ICON_VERSION}` }],
    shortcut: [{ url: `/images/brand/raithane-logo.jpeg?v=${ICON_VERSION}` }],
  },
  openGraph: {
    type: 'website',
    siteName: RESTAURANT.name,
    title: `${RESTAURANT.name} | ${RESTAURANT.tagline}`,
    description: SITE_DESCRIPTION,
    images: [{ url: RESTAURANT.logo, alt: `${RESTAURANT.name} logo` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: RESTAURANT.name,
    description: SITE_DESCRIPTION,
    images: [RESTAURANT.logo],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
  },
}

export const viewport = {
  themeColor: RESTAURANT.themeColor,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              const theme = localStorage.getItem('theme') || 'light';
              if (theme === 'dark') {
                document.documentElement.classList.add('dark');
              }
            })();
          `
        }} />
      </head>
      <body className={`font-sans antialiased`}>
        <AuthProvider>
          <CalendarSystemProvider>
            <ToastProvider>
              <ConfirmProvider>
                {children}
              </ConfirmProvider>
            </ToastProvider>
          </CalendarSystemProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
