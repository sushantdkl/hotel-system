import Guests from '@/components/hotel/guests';

export default async function GuestsPage({ searchParams }) {
  const params = await searchParams;
  return <Guests initialId={typeof params.guest === 'string' ? params.guest : null} />;
}
