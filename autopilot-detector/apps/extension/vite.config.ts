import { defineConfig } from "vite";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";
import * as fs from "fs";
import * as path from "path";

export default defineConfig({
  plugins: [
    webExtension({
      manifest: () => readJsonFile("manifest.json"),
    }),
    {
      name: "copy-icon",
      closeBundle() {
        const src = path.resolve(__dirname, "src/icon.png");
        const dest = path.resolve(__dirname, "dist/src/icon.png");
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log("✅ Custom copied src/icon.png to dist/src/icon.png");
        }
      }
    }
  ],
});
