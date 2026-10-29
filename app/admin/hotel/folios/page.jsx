import { Folios } from '@/components/hotel/screens';

export default async function FoliosPage({ searchParams }) {
  const params = await searchParams;
  return <Folios initialId={typeof params.guest === 'string' ? params.guest : null} />;
}
