import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3030,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.AEGIS_DASHBOARD_API_PORT ?? 3031}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3030,
  },
});
