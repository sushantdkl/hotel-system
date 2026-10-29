/**
 * cPanel / production entrypoint for Next.js.
 * Uses PORT and HOSTNAME injected by the host. Does not open a browser.
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

let server;

async function shutdown(signal) {
  console.log(`[pos] ${signal} received — shutting down`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const Database = (await import('./lib/db/index.js')).default;
    await Database.close();
  } catch (err) {
    console.error('[pos] shutdown error', err?.message || err);
  }
  process.exit(0);
}

app
  .prepare()
  .then(async () => {
    if (!dev && process.env.DATABASE_URL) {
      const { logPostgresStartupDiagnostics } = await import('./lib/db/postgres.js');
      await logPostgresStartupDiagnostics();
    }

    server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('[pos] request error', err?.message || err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });

    server.listen(port, hostname, () => {
      console.log(`[pos] ready on http://${hostname}:${port} (NODE_ENV=${process.env.NODE_ENV || 'undefined'})`);
    });

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('[pos] failed to start', err);
    process.exit(1);
  });
