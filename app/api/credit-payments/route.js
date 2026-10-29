import { goneLegacy } from '@/lib/api-guard.js';

export async function GET() {
  return goneLegacy('Legacy credit payments API');
}
export async function POST() {
  return goneLegacy('Legacy credit payments API');
}
