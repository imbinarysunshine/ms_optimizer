import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves this repo at https://<user>.github.io/ms_optimizer/,
  // not the domain root -- every asset URL needs this prefix at build time.
  base: "/ms_optimizer/",
  plugins: [react()],
  build: {
    // Multi-page build: docs.html is a separate, static (no React) page --
    // see its own header comment for why it isn't just another view inside
    // the SPA. Both entries land in dist/ as sibling files.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        docs: fileURLToPath(new URL("./docs.html", import.meta.url)),
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
