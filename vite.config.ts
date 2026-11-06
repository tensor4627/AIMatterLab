import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The development server needs its HMR websocket; packaged builds load local
// files only and must not keep a loopback development origin in the CSP.
const DEV_CONNECT_SOURCE = " ws://127.0.0.1:5173";
function productionCsp(){
 return {
  name:'production-csp',
  apply:'build',
  transformIndexHtml(html){
   if(!html.includes(DEV_CONNECT_SOURCE))throw new Error('Development CSP source is missing from index.html');
   return html.replace(DEV_CONNECT_SOURCE,'');
  }
 };
}

// Keep the large, independently versioned renderer dependencies in their own
// chunks so the application shell can be cached and parsed separately.
function manualChunks(id){
 if(!id.includes('node_modules'))return;
 if(id.includes('node_modules/monaco-editor/'))return 'monaco';
 if(id.includes('node_modules/echarts/')||id.includes('node_modules/zrender/'))return 'charts';
 if(id.includes('node_modules/three/'))return 'three';
 if(id.includes('node_modules/@xterm/'))return 'terminal';
 if(id.includes('node_modules/react/')||id.includes('node_modules/react-dom/')||id.includes('node_modules/scheduler/'))return 'react';
 if(id.includes('node_modules/lucide-react/'))return 'icons';
}

export default defineConfig({plugins:[react(),productionCsp()],base:'./',server:{host:'127.0.0.1',port:5173,strictPort:true},build:{chunkSizeWarningLimit:1800,rollupOptions:{output:{manualChunks}}}});
