import { fileURLToPath } from "node:url";
import config from "./vite.config";

// Render the production components with their shipped public logo and font files.
export default {
  ...config,
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
};
