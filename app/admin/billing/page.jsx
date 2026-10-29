'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy route — combined POS lives at /admin/pos */
export default function AdminBillingRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/pos'); }, [router]);
  return null;
}
