/** Open a hotel page from the sidebar. Below the desktop breakpoint the sidebar is off-screen, so open the menu first. */
export async function openHotelPage(page, label) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('aside nav').getByRole('button', { name: label, exact: true }).click();
}
