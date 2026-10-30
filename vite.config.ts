import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/api': SERVER,
    },
  },
});
