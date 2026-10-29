import AdminLayout from '@/components/admin/admin-layout';
import HotelWorkspace from '@/components/hotel/workspace';

export const metadata = { title: 'Hotel operations' };

export default function HotelLayout({ children }) {
  return <AdminLayout><HotelWorkspace>{children}</HotelWorkspace></AdminLayout>;
}
