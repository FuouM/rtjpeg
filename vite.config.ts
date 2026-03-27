/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "package.json",
);
const appVersion = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  .version as string;

/** Production-only CSP: limits XSS impact; dev leaves CSP off so Vite HMR stays usable. */
function contentSecurityPolicyBuild(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // data: — inlined woff2 from bundled CSS; 'self' — same-origin font files
    "font-src 'self' data:",
    "connect-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // frame-ancestors only applies when CSP is an HTTP header, not <meta>
  ].join("; ");
  return {
    name: "rtjpeg-content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      const escaped = csp.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${escaped}" />`,
      );
    },
  };
}

/** GitHub Pages: user site (`*.github.io` repo) uses `/`; project site uses `/<repo>/`. */
function pagesBase(): string {
  const explicit = process.env.VITE_BASE;
  if (explicit) {
    const t = explicit.trim();
    if (t === "" || t === "/") return "/";
    return t.endsWith("/") ? t : `${t}/`;
  }
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (!repo) return "/";
  if (repo.endsWith(".github.io")) return "/";
  return `/${repo}/`;
}

export default defineConfig({
  base: pagesBase(),
  define: {
    __RTJPEG_VERSION__: JSON.stringify(appVersion),
  },
  optimizeDeps: {
    // Keep ffmpeg.wasm out of prebundling so its worker/core URLs stay loadable in Vite and on Pages.
    exclude: ["@ffmpeg/ffmpeg"],
  },
  plugins: [
    VitePWA({
      // Prompt before swapping service-worker versions so open sessions do not
      // lose unsaved slider / preset UI state mid-use.
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icons.svg"],
      workbox: {
        // Keep the precache focused on the shell. Optional media/export chunks and
        // custom fonts can stream normally instead of bloating install/update cost.
        globPatterns: ["**/*.{js,css,html,ico,svg}"],
        globIgnores: [
          "**/ffmpeg-core-*.js",
          "**/videoTranscoder-*.js",
          "**/mp4box.all-*.js",
          "**/browser-*.js",
          "**/fix-webm-duration-*.js",
          "**/worker-*.js",
        ],
        navigateFallback: "index.html",
      },
      manifest: {
        name: "rtjpeg — Realtime JPEG sim",
        short_name: "rtjpeg",
        description:
          "WebGPU realtime JPEG-style video processing in the browser.",
        theme_color: "#000000",
        background_color: "#e8e8e8",
        display: "standalone",
        icons: [
          {
            src: "icons.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
    contentSecurityPolicyBuild(),
  ],
});
