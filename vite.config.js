import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2015",
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        gallery: resolve(__dirname, "gallery/index.html"),
        blog: resolve(__dirname, "blog/index.html"),
      },
    },
  },
});
