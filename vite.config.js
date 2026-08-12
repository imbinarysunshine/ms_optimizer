import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves this repo at https://<user>.github.io/ms_optimizer/,
  // not the domain root -- every asset URL needs this prefix at build time.
  base: "/ms_optimizer/",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
