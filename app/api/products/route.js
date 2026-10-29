import { goneLegacy } from '@/lib/api-guard.js';

/** Legacy multi-shop endpoint — removed from production POS. */
export async function GET() {
  return goneLegacy('Legacy shop products API');
}
export async function POST() {
  return goneLegacy('Legacy shop products API');
}
export async function PUT() {
  return goneLegacy('Legacy shop products API');
}
export async function PATCH() {
  return goneLegacy('Legacy shop products API');
}
export async function DELETE() {
  return goneLegacy('Legacy shop products API');
}
