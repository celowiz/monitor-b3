import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/monitor-b3/",
  plugins: [react()],
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
});
