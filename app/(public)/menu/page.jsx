import MenuBrowser from '@/components/public/menu-browser';
import { getPublicDeliveryPricing, getPublicMenuCategories } from '@/lib/public-menu';
import { getPublicBrand, getPublicContact, getPublicMenuPage } from '@/lib/public-content';
import { MenuSchema } from '@/components/public/structured-data';
import PageHead from '@/components/public/page-head';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const [page, brand] = await Promise.all([getPublicMenuPage(), getPublicBrand()]);
  return { title: 'Menu', description: `${page.lead} ${brand.name}.`, alternates: { canonical: '/menu' } };
}

export default async function MenuPage({ searchParams }) {
  const [contact, page, brand, params] = await Promise.all([getPublicContact(), getPublicMenuPage(), getPublicBrand(), searchParams]);
  let categories = [];
  let deliveryPricing = { enabled: false, mode: 'fixed', fixedFee: 0, bands: [] };
  try {
    [categories, deliveryPricing] = await Promise.all([getPublicMenuCategories(), getPublicDeliveryPricing()]);
  } catch {
    categories = [];
  }
  const initialCategory = categories.some((c) => c.id === params?.c) ? params.c : 'all';

  return (
    <>
      <MenuSchema categories={categories} />
      <PageHead title={page.heading} lead={page.lead} />
      {categories.length > 0 ? (
        <MenuBrowser
          categories={categories}
          whatsappNumber={contact.whatsappNumber}
          deliveryPricing={deliveryPricing}
          initialCategory={initialCategory}
          note={page.note}
          restaurantName={brand.name}
        />
      ) : (
        <div className="rc-wrap rc-empty">
          <p>The menu is being updated. Call <a href={contact.hrefs.tel} className="rc-link dsp-focus">{contact.phoneDisplay}</a> for today&apos;s dishes.</p>
        </div>
      )}
    </>
  );
}
