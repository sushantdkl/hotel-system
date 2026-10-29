import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-2xl font-semibold">Page not found</h2>
      <p className="text-sm text-muted-foreground">This link does not exist or was moved.</p>
      <Link href="/login" className="text-sm font-medium underline">
        Go to login
      </Link>
    </div>
  );
}
