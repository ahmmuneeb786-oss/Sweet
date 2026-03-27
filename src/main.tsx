import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Note: The '/' before sw.js is crucial because the file is in the public folder
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Sweet PWA Registered!', reg))
      .catch(err => console.log('PWA Registration failed', err));
  });
}