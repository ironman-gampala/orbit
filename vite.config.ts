import { defineConfig } from 'vite';

const tunnelHosts = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'];

export default defineConfig({
  server: { allowedHosts: tunnelHosts },
  preview: { allowedHosts: tunnelHosts, port: 4173, strictPort: true },
});
