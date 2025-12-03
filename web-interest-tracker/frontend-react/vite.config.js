import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/boards": "http://localhost:4000",
      "/tracked-items": "http://localhost:4000",
      "/agent": "http://localhost:4000",
      "/cart": "http://localhost:4000",
      "/triggers": "http://localhost:4000",
      "/discover": "http://localhost:4000",
      "/merchant-rules": "http://localhost:4000"
    }
  }
});
