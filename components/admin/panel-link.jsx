'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Keep shared admin/cashier screens inside the panel that opened them. */
export default function PanelLink({ href, ...props }) {
  const pathname = usePathname();
  let destination = href;
  if (pathname?.startsWith('/cashier') && typeof href === 'string' && href.startsWith('/admin')) {
    destination = href.replace(/^\/admin\/kot(?=\/|\?|$)/, '/cashier/kots').replace(/^\/admin/, '/cashier');
  }
  return <Link href={destination} {...props} />;
}
