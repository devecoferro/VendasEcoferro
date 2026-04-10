async (page) => {
  await page.context().storageState({
    path: "C:/Users/Kuster/Documents/New project/VendasEcoferro/data/playwright/private-seller-center.storage-state.json",
  });

  return {
    saved: true,
    url: page.url(),
    title: await page.title(),
  };
}
