import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PRODUCTION_API_BASE = "https://api.jadot.cn:8443";

function isLoopbackApiBase(value) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function resolveApiBase(env, isProd) {
  const configured = (env.VITE_API_BASE || "").trim();
  if (!isProd) return configured;

  const productionOverride = (env.VITE_PRODUCTION_API_BASE || "").trim();
  const candidate = productionOverride || configured;
  return !candidate || isLoopbackApiBase(candidate)
    ? DEFAULT_PRODUCTION_API_BASE
    : candidate;
}

function injectProductionSecurity(apiBase) {
  return {
    name: "inject-production-security",
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html;

      const connectSrc = [
        "'self'",
        "https://*.myqcloud.com",
        "https://*.tencentcos.cn",
        "https://media.jadot.cn",
        "https://media.jadot.club",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
      ];
      const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
      const trimmedApi = apiBase.trim().replace(/\/$/, "");
      if (trimmedApi) connectSrc.unshift(trimmedApi);

      const csp = [
        "default-src 'self'",
        `script-src ${scriptSrc.join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.myqcloud.com https://*.tencentcos.cn https://media.jadot.cn https://media.jadot.club",
        "media-src 'self' blob: https://*.myqcloud.com https://*.tencentcos.cn https://media.jadot.cn https://media.jadot.club",
        `connect-src ${connectSrc.join(" ")} blob:`,
        "font-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; ");

      const tags = [
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        '<meta http-equiv="Permissions-Policy" content="usb=(self), geolocation=(), camera=(), microphone=()" />',
        '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />',
        '<meta http-equiv="Pragma" content="no-cache" />',
        '<meta http-equiv="Expires" content="0" />',
      ].join("\n    ");

      return html.replace(
        '<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />',
        `<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />\n    ${tags}`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, PROJECT_ROOT, "");
  const apiDevUrl = env.VITE_DEV_API_URL || env.VITE_GIN_API_URL || "http://127.0.0.1:18080";
  const isProd = mode === "production";
  const apiBase = resolveApiBase(env, isProd);

  return {
    root: PROJECT_ROOT,
    plugins: [
      react(),
      injectProductionSecurity(apiBase),
    ],
    // Vite normally injects VITE_API_BASE directly from .env.local. Override
    // that replacement so a local development URL can never leak into a
    // production artifact.
    define: {
      "import.meta.env.VITE_API_BASE": JSON.stringify(apiBase),
    },
    base: env.VITE_BASE_PATH || "/",
    resolve: {
      preserveSymlinks: true,
      alias: {
        "@v1pro-webusb": fileURLToPath(new URL("./public/webusb", import.meta.url)),
      },
    },
    build: {
      sourcemap: false,
      minify: "esbuild",
      cssMinify: true,
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            ffmpeg: ["@ffmpeg/ffmpeg"],
          },
        },
      },
    },
    esbuild: {
      drop: isProd ? ["console", "debugger"] : [],
      legalComments: "none",
    },
    server: {
      // Browser smoke tests and local tooling may create Chrome profiles under
      // the repository (tmp-*).  Those profiles contain locked SQLite/Cookie
      // files on Windows; watching them can crash Vite with EBUSY before the
      // page is served.  Keep temporary diagnostics out of the watcher while
      // still reloading normal source/config changes.
      watch: {
        ignored: ["**/tmp-*", "**/outputs/**"],
      },
      proxy: {
        "/api": {
          target: apiDevUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
