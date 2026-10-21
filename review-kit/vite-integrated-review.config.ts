/** Explicit opt-in private app build. Never used by npm run build or deployment. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import applicationConfig from "../vite.config";

const reviewDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async (environment) => {
  if (process.env.KOVA_PRIVATE_INTEGRATED_REVIEW !== "1")
    throw new Error(
      "Integrated review requires KOVA_PRIVATE_INTEGRATED_REVIEW=1. Use the normal config for production.",
    );
  if (process.env.KOVA_BROWSER_PREVIEW !== "node")
    throw new Error("Integrated review is restricted to the private Node browser preview.");
  const application =
    typeof applicationConfig === "function"
      ? await applicationConfig(environment)
      : await applicationConfig;
  return mergeConfig(application, {
    resolve: {
      alias: [
        {
          find: /^@\/components\/ConversationHeaderActions$/,
          replacement: path.join(reviewDirectory, "IntegratedConversationHeader.tsx"),
        },
      ],
    },
  });
});
