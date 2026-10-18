import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

// Offline support after the first visit (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`./sw.js?v=${__BUILD__}`).catch(() => { /* optional */ });
    // once the scene is up, hand the worker everything this first visit downloaded (page, data, tiles)
    const warm = () => navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'warm', urls: [location.href, ...performance.getEntriesByType('resource').map((e) => e.name)] }));
    setTimeout(warm, 8000);
    setTimeout(warm, 30000);   // outer terrain rings arrive later
  });
}
