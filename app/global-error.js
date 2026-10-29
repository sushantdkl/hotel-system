'use client';

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 40, textAlign: 'center' }}>
        <h2>Application error</h2>
        <p>The POS could not load this page. Please refresh or try again later.</p>
        <button type="button" onClick={() => reset()} style={{ marginTop: 16, padding: '8px 16px' }}>
          Try again
        </button>
        {process.env.NODE_ENV !== 'production' && error?.message ? (
          <pre style={{ marginTop: 24, textAlign: 'left', fontSize: 12 }}>{error.message}</pre>
        ) : null}
      </body>
    </html>
  );
}
