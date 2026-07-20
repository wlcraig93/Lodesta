import { defineConfig } from "vite";

export default defineConfig({
  preview: { allowedHosts: true },
  build: { emptyOutDir: true, sourcemap: false }
});
