'use client';

import { Suspense } from 'react';
import ReportComparison from '@/components/admin/report-comparison.jsx';

export default function CompareReportsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">Loading comparison…</div>}>
      <ReportComparison />
    </Suspense>
  );
}
