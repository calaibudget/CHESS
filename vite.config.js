import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

function copyStockfishPlugin() {
  return {
    name: 'copy-stockfish',
    buildStart() {
      const pub = resolve('public');
      if (!existsSync(pub)) mkdirSync(pub, { recursive: true });
      const bin = resolve('node_modules/stockfish/bin');
      try {
        copyFileSync(`${bin}/stockfish-18-lite-single.js`,   `${pub}/stockfish-lite.js`);
        copyFileSync(`${bin}/stockfish-18-lite-single.wasm`, `${pub}/stockfish.wasm`);
      } catch (e) {
        console.warn('[copy-stockfish] Could not copy stockfish files:', e.message);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyStockfishPlugin()],
  worker: { format: 'es' },
});
