// Sesión: quién es la persona, con qué empresa trabaja y qué puede hacer. El token lo administra el proveedor de identidad
// (identidad.ts); acá solo se guarda la empresa elegida (sessionStorage: se pierde al cerrar la pestaña).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configurarSesion, ErrorApi, obtener } from './api';
import { elegirIdentidad, type Identidad } from './identidad';
import type { Yo } from './tipos';

export type PersonaDev = { clave: string; descripcion: string; token: string };
type Estado = 'cargando' | 'sin_sesion' | 'lista';
type Valor = {
  estado: Estado; yo: Yo | null; error: string | null; permisos: Set<string>; puede: (permiso: string) => boolean;
  identidad: Identidad;
  /** Cambiar la contraseña tras el enlace de recuperación: mientras sea true se muestra esa pantalla y no el sistema. */
  recuperando: boolean; terminarRecuperacion: () => void;
  /** Se llama después de que la identidad ya tiene sesión (ingreso con clave, enlace o persona de prueba). */
  alIngresar: () => Promise<void>; salir: () => Promise<void>; elegirEmpresa: (id: number | null) => Promise<void>;
  /** Vuelve a leer quién es la persona y a qué empresas accede (después de crear o dar de baja una empresa, por ejemplo). */
  refrescarYo: () => Promise<void>;
};
const Contexto = createContext<Valor | null>(null);

const leer = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* almacenamiento bloqueado: la elección dura lo que dure la pestaña */ } };
const identidadGlobal = elegirIdentidad(import.meta.env, `${location.origin}${location.pathname}`);

export function ProveedorSesion({ children, identidad = identidadGlobal }: { children: ReactNode; identidad?: Identidad }) {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [yo, setYo] = useState<Yo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recuperando, setRecuperando] = useState(false);

  const limpiar = useCallback((mensaje: string | null = null) => {
    configurarSesion({ empresaId: null }); guardar('empresa', null);
    setYo(null); setError(mensaje); setEstado('sin_sesion');
  }, []);

  const cargarYo = useCallback(async (empresaId: number | null): Promise<void> => {
    configurarSesion({ empresaId });
    try {
      const datos = await obtener<Yo>('/api/yo');
      // Con una sola empresa no hay nada que elegir.
      if (!empresaId && datos.empresas.length === 1) { guardar('empresa', String(datos.empresas[0].id)); return await cargarYo(datos.empresas[0].id); }
      setYo(datos); setError(null); setEstado('lista');
    } catch (e) {
      // Una empresa guardada que ya no está disponible no tira la sesión: se vuelve al selector.
      if (empresaId && e instanceof ErrorApi && e.codigo === 'empresa_invalida') { guardar('empresa', null); return cargarYo(null); }
      throw e;
    }
  }, []);

  useEffect(() => {
    configurarSesion({ obtenerToken: identidad.token, alVencer: () => { void identidad.salir(); limpiar('Tu sesión venció. Volvé a ingresar.'); } });
    const dejar = identidad.alCambiar((evento) => { if (evento === 'cerrada') limpiar(null); else if (evento === 'recuperacion') setRecuperando(true); });
    let vivo = true;
    (async () => {
      if (!(await identidad.token())) { if (vivo) setEstado('sin_sesion'); return; }
      try { await cargarYo(Number(leer('empresa')) || null); }
      catch (e) { if (vivo) limpiar(e instanceof ErrorApi && e.estado === 403 ? e.message : null); }
    })();
    return () => { vivo = false; dejar(); };
  }, [identidad, cargarYo, limpiar]);

  const alIngresar = useCallback(async () => {
    guardar('empresa', null);
    try { await cargarYo(null); }
    catch (e) {
      // Autenticó pero no figura en el sistema (o el servidor falló): se cierra la sesión del proveedor para no dejarla a medias.
      const m = e instanceof ErrorApi ? e.message : 'No se pudo ingresar.'; await identidad.salir(); limpiar(m); throw e;
    }
  }, [cargarYo, limpiar, identidad]);

  const elegirEmpresa = useCallback(async (id: number | null) => { guardar('empresa', id ? String(id) : null); await cargarYo(id); }, [cargarYo]);
  const refrescarYo = useCallback(() => cargarYo(yo?.empresa_activa?.id ?? null), [cargarYo, yo]);
  const salir = useCallback(async () => { await identidad.salir(); limpiar(null); }, [identidad, limpiar]);

  const permisos = useMemo(() => new Set(yo?.empresa_activa?.permisos ?? []), [yo]);
  const valor = useMemo<Valor>(() => ({ estado, yo, error, permisos, puede: (p) => permisos.has(p), identidad, recuperando, terminarRecuperacion: () => setRecuperando(false), alIngresar, salir, elegirEmpresa, refrescarYo }),
    [estado, yo, error, permisos, identidad, recuperando, alIngresar, salir, elegirEmpresa, refrescarYo]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): Valor {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSesion fuera de ProveedorSesion');
  return v;
}
