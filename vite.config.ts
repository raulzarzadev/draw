import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@draw/scene-sync": fileURLToPath(new URL("./pocketbase/hooks/lib/scene.cjs", import.meta.url)) },
  },
  optimizeDeps: { include: ["@draw/scene-sync"] },
  preview: {
    allowedHosts: ["draw.raulzarza.com", "draw-production-09ec.up.railway.app"],
  },
});
