// Resolves the "@/..." alias (defined in jsconfig.json for Next.js's bundler)
// so plain `node --test` can import the same source files without a bundler.
// Next's webpack resolver also tolerates extensionless internal imports
// (e.g. `from '@/lib/time-utils'`) — Node's ESM resolver doesn't, so retry
// with a `.js` suffix before giving up.
const root = new URL('../../', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const target = specifier.startsWith('@/') ? new URL(specifier.slice(2), root).href : specifier;
  try {
    return await nextResolve(target, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && !target.endsWith('.js')) {
      return nextResolve(`${target}.js`, context);
    }
    throw error;
  }
}
