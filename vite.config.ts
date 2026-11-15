import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { tideDevServer } from "./server/dev-plugin";

export default defineConfig({
  plugins: [solidPlugin(), tailwindcss(), tideDevServer()],
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
  },
});
