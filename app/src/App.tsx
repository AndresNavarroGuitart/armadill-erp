// Estructura de la aplicación: ingreso → elección de empresa → menú con sus pantallas. Router mínimo por hash (#/clientes).
import { useEffect, useState, type ReactElement } from 'react';
import { useSesion } from './sesion';
import { Cargando } from './ui';
import { Ingreso } from './pantallas/Ingreso';
import { ElegirEmpresa } from './pantallas/ElegirEmpresa';
import { Terceros } from './pantallas/Terceros';
import { Articulos } from './pantallas/Articulos';
import { NuevaFactura } from './pantallas/NuevaFactura';
import { Comprobantes } from './pantallas/Comprobantes';
import { cuitConGuiones, nombreCondicion } from './formato';

type Ruta = { clave: string; titulo: string; permiso: string; icono: string; pantalla: () => ReactElement };
const RUTAS: Ruta[] = [
  { clave: 'factura', titulo: 'Facturar', permiso: 'ventas.emitir', icono: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5', pantalla: () => <NuevaFactura /> },
  { clave: 'comprobantes', titulo: 'Comprobantes', permiso: 'ventas.ver', icono: 'M4 6h16M4 12h16M4 18h10', pantalla: () => <Comprobantes /> },
  { clave: 'clientes', titulo: 'Clientes', permiso: 'clientes.ver', icono: 'M12 12a4 4 0 100-8 4 4 0 000 8z M4 21a8 8 0 0116 0', pantalla: () => <Terceros rol="cliente" /> },
  { clave: 'proveedores', titulo: 'Proveedores', permiso: 'proveedores.ver', icono: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10', pantalla: () => <Terceros rol="proveedor" /> },
  { clave: 'articulos', titulo: 'Artículos', permiso: 'articulos.ver', icono: 'M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5', pantalla: () => <Articulos /> },
];
const rutaActual = () => location.hash.replace(/^#\/?/, '').split('/')[0];

export function App() {
  const { estado, yo, error, puede, salir, elegirEmpresa } = useSesion();
  const [clave, setClave] = useState(rutaActual());
  const [tema, setTema] = useState(document.documentElement.dataset.theme ?? 'light');
  useEffect(() => { const f = () => setClave(rutaActual()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { document.documentElement.dataset.theme = tema; try { localStorage.setItem('tema', tema); } catch { /* sin almacenamiento */ } }, [tema]);

  if (estado === 'cargando') return <div className="ingreso"><Cargando texto="Entrando…" /></div>;
  if (estado === 'sin_sesion' || !yo) return <Ingreso mensaje={error} />;
  const activa = yo.empresa_activa;
  if (!activa) return <ElegirEmpresa />;

  const disponibles = RUTAS.filter((r) => puede(r.permiso));
  const actual = disponibles.find((r) => r.clave === clave) ?? disponibles[0];
  const iniciales = yo.usuario.nombre.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  document.title = `${actual ? actual.titulo + ' · ' : ''}${activa.razon_social} · administraNET`;

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
          <div className="empresa"><strong>{activa.razon_social}</strong><span>CUIT {cuitConGuiones(activa.cuit)} · {nombreCondicion(activa.condicion_iva_codigo)} · {activa.rol}</span></div>
          {yo.empresas.length > 1 && <button className="btn chico" onClick={() => elegirEmpresa(null)}>Cambiar de empresa</button>}
          <div className="sp" />
          <button className="icono" onClick={() => setTema(tema === 'dark' ? 'light' : 'dark')} aria-label={tema === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>{tema === 'dark' ? '☀' : '☾'}</button>
          <button className="btn chico" onClick={salir}>Salir</button>
          <div className="avatar" title={yo.usuario.nombre}>{iniciales}</div>
        </header>
        <main className="vista" key={`${activa.id}-${actual?.clave}`}>
          {actual ? actual.pantalla() : <div className="tarjeta">Tu rol en esta empresa no tiene pantallas habilitadas. Pedile acceso al administrador del estudio.</div>}
        </main>
      </div>
    </div>
  );
}
