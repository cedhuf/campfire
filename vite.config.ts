import { defineConfig } from "vite";

const backendPort = process.env.PORT ?? "3000";

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
