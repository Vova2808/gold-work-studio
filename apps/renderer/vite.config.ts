import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const debugReact = process.env.GWS_REACT_DEBUG === '1';
const reactEnvironment = debugReact ? 'development' : 'production';

export default defineConfig({
  plugins: debugReact ? [react()] : [],
  define: { 'process.env.NODE_ENV': JSON.stringify(reactEnvironment) },
  esbuild: { jsxDev: debugReact },
  optimizeDeps: { esbuildOptions: { define: { 'process.env.NODE_ENV': JSON.stringify(reactEnvironment) }, jsxDev: debugReact } },
  // A previous tsc invocation may have emitted stale .js beside .tsx sources.
  // Always prefer the editable source; checks must never select those copies.
  resolve: { extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"] }
});
