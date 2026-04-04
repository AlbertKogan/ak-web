import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2015",
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        index: './index.html',
        bg: './src/js/background.js',
      },
      output: {
        // Give the background bundle a stable (unhashed) path so pre-rendered
        // blog pages can reference it without knowing the build hash.
        entryFileNames: (chunk) =>
          chunk.name === 'bg' ? 'bg.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
