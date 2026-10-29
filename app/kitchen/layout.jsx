import StaffAreaGuard from '@/components/auth/staff-area-guard';

export default function KitchenLayout({ children }) {
  return <StaffAreaGuard>{children}</StaffAreaGuard>;
}
