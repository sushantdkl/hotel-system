import { goneLegacy } from '@/lib/api-guard.js';

export async function GET() {
  return goneLegacy('Legacy ingredients API');
}
export async function POST() {
  return goneLegacy('Legacy ingredients API');
}
