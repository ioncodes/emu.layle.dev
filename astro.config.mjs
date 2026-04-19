import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://emu.layle.dev",
  vite: {
    plugins: [tailwindcss()],
  },
});
