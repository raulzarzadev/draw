import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: ["draw.raulzarza.com", "draw-production-09ec.up.railway.app"],
  },
});
