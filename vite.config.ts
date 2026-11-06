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

export default defineConfig({plugins:[react(),productionCsp()],base:'./',server:{host:'127.0.0.1',port:5173,strictPort:true},build:{chunkSizeWarningLimit:1800}});
