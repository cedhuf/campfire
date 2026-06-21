import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const backendPort = process.env.PORT ?? "3000";

export default defineConfig({
  root: "web",
  // Serve repo-root static/ (sounds_fx, …) at / in dev and copy it into dist on build.
  publicDir: fileURLToPath(new URL("./static", import.meta.url)),
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
