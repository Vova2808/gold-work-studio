import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(fileURLToPath(import.meta.url));

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
    root: resolve(projectDirectory, "../renderer"),
    server: { host: "127.0.0.1" },
    build: {
      outDir: resolve(projectDirectory, "dist/renderer"),
      rollupOptions: { input: resolve(projectDirectory, "../renderer/index.html") }
    }
  }
});
