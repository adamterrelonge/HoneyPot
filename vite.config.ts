/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The only chunk above 500 kB is PixiJS itself (~670 kB, ~190 kB gzipped). It can't be split by
    // size: Pixi registers its renderers through import side effects, and a size split reorders them
    // ("Cannot read properties of undefined (reading 'add')" at start-up). App code stays ~200 kB.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Vendor code in its own long-lived chunks: app releases don't invalidate the cached
        // renderer or React, and no single chunk goes over Vite's 500 kB warning.
        codeSplitting: {
          groups: [
            { name: "pixi", test: /node_modules[\\/](pixi\.js|@pixi|earcut|eventemitter3|parse-svg-path|ismobilejs)/ },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
