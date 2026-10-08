import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built dist/ works from any subfolder, not just a server root.
  base: "./",
  // Listen on the LAN too, for testing from a tablet/phone. Web MIDI still needs
  // HTTPS (or localhost) on the client side.
  server: { host: true },
  preview: { host: true },
});
