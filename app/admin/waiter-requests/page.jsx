'use client';

import AdminLayout from '@/components/admin/admin-layout';
import WaiterRequestsBoard from '@/components/waiter-requests/waiter-requests-board';

export default function AdminWaiterRequestsPage() {
  return (
    <AdminLayout>
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <WaiterRequestsBoard />
      </main>
    </AdminLayout>
  );
}
