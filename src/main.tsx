import './ui/install';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './app/app';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><HashRouter><App /></HashRouter></StrictMode>,
);

if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
  const worker = new URL('sw.js', document.baseURI);
  void navigator.serviceWorker.register(worker).catch(error => {
    console.warn('离线资源暂未缓存。', error);
  });
}
