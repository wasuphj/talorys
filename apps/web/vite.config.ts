import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { resolve } from "node:path";

// In development, /api is proxied to `wrangler pages dev` (port 8788), which runs the
// real Pages Function and reaches the agent Worker through its service binding.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: resolve(import.meta.dirname, "../../node_modules/react"),
      "react-dom": resolve(import.meta.dirname, "../../node_modules/react-dom"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://127.0.0.1:18788",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
});
