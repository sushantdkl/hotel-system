'use client';

export default function Error({ error, reset }) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        Please try again. If the problem continues, refresh the page or contact your manager.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium"
      >
        Try again
      </button>
      {process.env.NODE_ENV !== 'production' && error?.message ? (
        <pre className="text-xs text-left max-w-lg overflow-auto opacity-70">{error.message}</pre>
      ) : null}
    </div>
  );
}
