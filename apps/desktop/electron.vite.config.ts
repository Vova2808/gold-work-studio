import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
// pnpm dev is also the user's normal launcher. React 19's development
// Performance tracks clone large project props on every commit and can OOM.
// Keep Vite reloads, but enable expensive React profiling only explicitly.
const reactEnvironment = process.env.GWS_REACT_DEBUG === '1' ? 'development' : 'production';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: resolve(projectDirectory, "src/main.ts"),
        // CommonJS для main — штатный формат Electron. В ESM-режиме загрузчик Electron падал на
        // «Cannot read properties of undefined (reading 'exports')» при импорте самого electron.
        output: { format: "cjs", entryFileNames: "index.cjs" }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: resolve(projectDirectory, "src/preload.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" }
      }
    }
  },
  renderer: {
    define: { 'process.env.NODE_ENV': JSON.stringify(reactEnvironment) },
    esbuild: { jsxDev: reactEnvironment === 'development' },
    optimizeDeps: { esbuildOptions: { define: { 'process.env.NODE_ENV': JSON.stringify(reactEnvironment) }, jsxDev: reactEnvironment === 'development' } },
    root: resolve(projectDirectory, "../renderer"),
    resolve: { extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"] },
    server: { host: "127.0.0.1" },
    build: {
      outDir: resolve(projectDirectory, "dist/renderer"),
      rollupOptions: { input: resolve(projectDirectory, "../renderer/index.html") }
    }
  }
});
