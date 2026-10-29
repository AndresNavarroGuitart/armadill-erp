import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo el front y la API comparten origen a través del proxy: no hace falta abrir CORS.
const API = process.env.API_URL ?? 'http://127.0.0.1:3020';
export default defineConfig({
  plugins: [react()],
  server: { port: 3030, strictPort: true, proxy: { '/api': API, '/dev': API } },
  test: { environment: 'node' },
});
