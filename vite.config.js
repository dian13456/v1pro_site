import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiDevUrl = env.VITE_DEV_API_URL || env.VITE_GIN_API_URL || "http://127.0.0.1:18080";

  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "/",
    server: {
      proxy: {
        "/api": {
          target: apiDevUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
