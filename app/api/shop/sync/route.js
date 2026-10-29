import { goneLegacy } from '@/lib/api-guard.js';

export async function GET() {
  return goneLegacy('Legacy shop sync');
}
export async function POST() {
  return goneLegacy('Legacy shop sync');
}
