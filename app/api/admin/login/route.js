import { goneLegacy } from '@/lib/api-guard.js';

/** Use POST /api/auth/login instead. */
export async function POST() {
  return goneLegacy('Legacy admin login');
}
