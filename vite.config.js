import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function injectProductionSecurity(apiBase) {
  return {
    name: "inject-production-security",
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html;

      const connectSrc = ["'self'", "https://*.myqcloud.com"];
      const trimmedApi = apiBase.trim().replace(/\/$/, "");
      if (trimmedApi) connectSrc.unshift(trimmedApi);

      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.myqcloud.com",
        "media-src 'self' blob: https://*.myqcloud.com",
        `connect-src ${connectSrc.join(" ")}`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; ");

      const tags = [
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        '<meta http-equiv="Permissions-Policy" content="usb=(self), geolocation=(), camera=(), microphone=()" />',
      ].join("\n    ");

      return html.replace(
        '<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />',
        `<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />\n    ${tags}`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiDevUrl = env.VITE_DEV_API_URL || env.VITE_GIN_API_URL || "http://127.0.0.1:18080";
  const isProd = mode === "production";

  return {
    plugins: [react(), injectProductionSecurity(env.VITE_API_BASE || "")],
    base: env.VITE_BASE_PATH || "/",
    build: {
      sourcemap: false,
      minify: "esbuild",
      cssMinify: true,
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
    esbuild: {
      drop: isProd ? ["console", "debugger"] : [],
      legalComments: "none",
    },
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
