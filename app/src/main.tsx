import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';
import { App } from './App';
import { ProveedorSesion } from './sesion';
import { ProveedorAvisos } from './ui';

try { const t = localStorage.getItem('tema'); if (t) document.documentElement.dataset.theme = t; } catch { /* sin almacenamiento: queda el tema claro */ }

createRoot(document.getElementById('raiz')!).render(
  <StrictMode><ProveedorAvisos><ProveedorSesion><App /></ProveedorSesion></ProveedorAvisos></StrictMode>,
);
