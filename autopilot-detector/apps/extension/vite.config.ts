import { defineConfig } from "vite";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [
    webExtension({
      manifest: () => readJsonFile("manifest.json"),
    }),
  ],
});
