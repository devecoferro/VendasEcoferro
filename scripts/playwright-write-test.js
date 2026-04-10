async (page) => {
  const fs = require("node:fs");
  fs.writeFileSync(
    "C:/Users/Kuster/Documents/New project/VendasEcoferro/data/playwright/run-code-write-test.txt",
    "ok",
    "utf8"
  );
  return { wrote: true, url: page.url() };
}
