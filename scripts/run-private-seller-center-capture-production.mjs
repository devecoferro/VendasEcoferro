import path from "node:path";
import { resolveAdminCredentials } from "./_lib/admin-credentials.mjs";

const projectRoot = process.cwd();
const adminCredentials = resolveAdminCredentials();

process.env.ECOFERRO_CAPTURE_BASE_URL ||= "https://vendas.ecoferro.com.br";
process.env.ECOFERRO_CAPTURE_USERNAME ||= adminCredentials.username;
process.env.ECOFERRO_CAPTURE_PASSWORD ||= adminCredentials.password;
process.env.SELLER_CENTER_CAPTURE_STORAGE_STATE_PATH ||= path.join(
  projectRoot,
  "data",
  "playwright",
  "private-seller-center.storage-state.json"
);

process.argv = [
  process.argv[0],
  path.join(projectRoot, "scripts", "capture-private-seller-center-snapshots.mjs"),
  ...process.argv.slice(2),
];

await import("./capture-private-seller-center-snapshots.mjs");
