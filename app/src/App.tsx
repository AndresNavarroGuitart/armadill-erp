// Estructura de la aplicación: ingreso → elección de empresa → menú con sus pantallas. Router mínimo por hash (#/clientes).
import { useEffect, useState, type ReactElement } from 'react';
import { useSesion } from './sesion';
import { Cargando } from './ui';
import { Ingreso, NuevaClave } from './pantallas/Ingreso';
import { ElegirEmpresa } from './pantallas/ElegirEmpresa';
import { Terceros } from './pantallas/Terceros';
import { Articulos } from './pantallas/Articulos';
import { NuevaFactura } from './pantallas/NuevaFactura';
import { Comprobantes } from './pantallas/Comprobantes';
import { Estudio } from './pantallas/Estudio';
import { Stock } from './pantallas/Stock';
import { Listas } from './pantallas/Listas';
import { Trazabilidad } from './pantallas/Trazabilidad';
import { cuitConGuiones, nombreCondicion } from './formato';

type Ruta = { clave: string; titulo: string; permiso: string; icono: string; pantalla: () => ReactElement };
const RUTAS: Ruta[] = [
  { clave: 'factura', titulo: 'Facturar', permiso: 'ventas.emitir', icono: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5', pantalla: () => <NuevaFactura /> },
  { clave: 'comprobantes', titulo: 'Comprobantes', permiso: 'ventas.ver', icono: 'M4 6h16M4 12h16M4 18h10', pantalla: () => <Comprobantes /> },
  { clave: 'clientes', titulo: 'Clientes', permiso: 'clientes.ver', icono: 'M12 12a4 4 0 100-8 4 4 0 000 8z M4 21a8 8 0 0116 0', pantalla: () => <Terceros rol="cliente" /> },
  { clave: 'proveedores', titulo: 'Proveedores', permiso: 'proveedores.ver', icono: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10', pantalla: () => <Terceros rol="proveedor" /> },
  { clave: 'articulos', titulo: 'Artículos', permiso: 'articulos.ver', icono: 'M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5', pantalla: () => <Articulos /> },
  { clave: 'listas', titulo: 'Listas', permiso: 'articulos.ver', icono: 'M4 6h16 M4 12h16 M4 18h16 M7 3v6 M15 9v6 M10 15v6', pantalla: () => <Listas /> },
  { clave: 'stock', titulo: 'Stock', permiso: 'stock.ver', icono: 'M3 9l9-6 9 6v11H3z M9 20v-7h6v7', pantalla: () => <Stock /> },
];
/** Administración del estudio: no depende de una empresa ni de un permiso de rol; la habilita la marca de administrador del estudio. */
const RUTA_ESTUDIO: Ruta = { clave: 'estudio', titulo: 'Estudio', permiso: '@estudio', icono: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6 M9 10h.01 M15 10h.01', pantalla: () => <Estudio /> };
const RUTA_TRAZABILIDAD: Ruta = { clave: 'trazabilidad', titulo: 'Trazabilidad', permiso: '@estudio', icono: 'M12 8v5l3 2 M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8 M3 3v5h5', pantalla: () => <Trazabilidad /> };
const rutaActual = () => location.hash.replace(/^#\/?/, '').split('/')[0];

export function App() {
  const { estado, yo, error, puede, salir, elegirEmpresa, recuperando, terminarRecuperacion } = useSesion();
  const [clave, setClave] = useState(rutaActual());
  const [tema, setTema] = useState(document.documentElement.dataset.theme ?? 'light');
  useEffect(() => { const f = () => setClave(rutaActual()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { document.documentElement.dataset.theme = tema; try { localStorage.setItem('tema', tema); } catch { /* sin almacenamiento */ } }, [tema]);

  if (recuperando) return <NuevaClave onListo={terminarRecuperacion} />;
  if (estado === 'cargando') return <div className="ingreso"><Cargando texto="Entrando…" /></div>;
  if (estado === 'sin_sesion' || !yo) return <Ingreso mensaje={error} />;
  const activa = yo.empresa_activa;
  // Una persona que administra el estudio puede trabajar sin empresa activa (por ejemplo, para dar de alta la primera).
  const enEstudio = yo.admin_estudio && ((clave === 'estudio' || clave === 'trazabilidad') || (!activa && yo.empresas.length === 0));
  if (!activa && !enEstudio) return <ElegirEmpresa />;

  const disponibles = [...(activa ? RUTAS.filter((r) => puede(r.permiso)) : []), ...(yo.admin_estudio ? [RUTA_ESTUDIO, RUTA_TRAZABILIDAD] : [])];
  const actual = disponibles.find((r) => r.clave === clave) ?? disponibles[0];
  const iniciales = yo.usuario.nombre.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  document.title = [actual?.titulo, activa?.razon_social, 'administraNET'].filter(Boolean).join(' · ');

  return (
    <div className="app">
      <nav className="rail" aria-label="Menú principal">
        <div className="logo" aria-hidden="true">a</div>
        {disponibles.map((r) => (
          <a key={r.clave} href={`#/${r.clave}`} aria-current={actual?.clave === r.clave ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={r.icono} /></svg>{r.titulo}
          </a>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          {activa
            ? <div className="empresa"><strong>{activa.razon_social}</strong><span>CUIT {cuitConGuiones(activa.cuit)} · {nombreCondicion(activa.condicion_iva_codigo)} · {activa.rol}</span></div>
            : <div className="empresa"><strong>Administración del estudio</strong><span>Sin empresa activa</span></div>}
          {activa && yo.empresas.length > 1 && <button className="btn chico" onClick={() => elegirEmpresa(null)}>Cambiar de empresa</button>}
          {!activa && yo.empresas.length > 0 && <button className="btn chico" onClick={() => { location.hash = ''; }}>Trabajar en una empresa</button>}
          <div className="sp" />
          <button className="icono" onClick={() => setTema(tema === 'dark' ? 'light' : 'dark')} aria-label={tema === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>{tema === 'dark' ? '☀' : '☾'}</button>
          <button className="btn chico" onClick={() => void salir()}>Salir</button>
          <div className="avatar" title={yo.usuario.nombre}>{iniciales}</div>
        </header>
        <main className="vista" key={`${activa?.id ?? 0}-${actual?.clave}`}>
          {actual ? actual.pantalla() : <div className="tarjeta">Tu rol en esta empresa no tiene pantallas habilitadas. Pedile acceso al administrador del estudio.</div>}
        </main>
      </div>
    </div>
  );
}
