import StaffAreaGuard from '@/components/auth/staff-area-guard';

export default function WaiterLayout({ children }) {
  return <StaffAreaGuard>{children}</StaffAreaGuard>;
}
