import Link from 'next/link';
import VerificationBoard from '@/components/cancellations/verification-board';
export default function KitchenCancellationsPage() { return <main className="space-y-5 p-4 sm:p-6"><Link href="/kitchen" className="inline-block rounded border px-4 py-2">Back to kitchen</Link><VerificationBoard kitchen /></main>; }
