import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// 部署在 nginx 的 /workbench/ 子路径时设置 WEB_BASE_PATH=/workbench/；本地开发保持根路径
// @ts-expect-error process is a nodejs global
const webBasePath = process.env.WEB_BASE_PATH || "/";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: webBasePath,

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  server: {
    // 本地开发：REST API 转发到本地后端（server/index.mjs，默认 3002）
    proxy: {
      "/api": "http://127.0.0.1:3002",
    },
  },
});
