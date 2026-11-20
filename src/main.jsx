import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import './i18n';
import './hooks/useTheme'; // aplica el tema y sigue al sistema desde el arranque
import { buildInfo } from './lib/buildInfo';
import PWAPrompts from './components/PWAPrompts';
import './hooks/usePWAInstall'; // captura beforeinstallprompt antes de montar nada

// Útil para soporte: saber qué build está corriendo el usuario desde la consola.
window.__APP_BUILD__ = buildInfo;

// La app guarda las actividades en local: pide almacenamiento persistente para que el
// navegador no lo borre por falta de espacio (Chrome lo concede sin preguntar si está instalada).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <PWAPrompts />
    </BrowserRouter>
  </StrictMode>,
);
