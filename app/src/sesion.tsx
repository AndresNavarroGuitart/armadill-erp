// Sesión: token, persona, empresa activa y permisos. El token se guarda solo en sessionStorage (se pierde al cerrar la pestaña).
// El ingreso real lo hará el proveedor de identidad (Supabase Auth); mientras tanto, en desarrollo, el servidor ofrece tokens de prueba.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configurarSesion, ErrorApi, obtener } from './api';
import type { Yo } from './tipos';

export type PersonaDev = { clave: string; descripcion: string; token: string };
type Estado = 'cargando' | 'sin_sesion' | 'lista';
type Valor = {
  estado: Estado; yo: Yo | null; error: string | null; permisos: Set<string>; puede: (permiso: string) => boolean;
  ingresar: (token: string) => Promise<void>; salir: () => void; elegirEmpresa: (id: number | null) => Promise<void>;
};
const Contexto = createContext<Valor | null>(null);

const leer = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* almacenamiento bloqueado: la sesión dura lo que dure la pestaña abierta */ } };

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [yo, setYo] = useState<Yo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limpiar = useCallback((mensaje: string | null = null) => {
    configurarSesion({ token: null, empresaId: null }); guardar('token', null); guardar('empresa', null);
    setYo(null); setError(mensaje); setEstado('sin_sesion');
  }, []);

  const cargarYo = useCallback(async (empresaId: number | null): Promise<void> => {
    configurarSesion({ empresaId });
    try {
      const datos = await obtener<Yo>('/api/yo');
      // Con una sola empresa no hay nada que elegir.
      if (!empresaId && datos.empresas.length === 1) { guardar('empresa', String(datos.empresas[0].id)); return await cargarYo(datos.empresas[0].id); }
      setYo(datos); setError(null); setEstado('lista');
    }
    catch (e) {
      // Una empresa guardada que ya no está disponible no tira la sesión: se vuelve al selector.
      if (empresaId && e instanceof ErrorApi && e.codigo === 'empresa_invalida') { guardar('empresa', null); return cargarYo(null); }
      throw e;
    }
  }, []);

  useEffect(() => {
    configurarSesion({ alVencer: () => limpiar('Tu sesión venció. Volvé a ingresar.') });
    const token = leer('token');
    if (!token) { setEstado('sin_sesion'); return; }
    configurarSesion({ token });
    const empresa = Number(leer('empresa')) || null;
    cargarYo(empresa).catch((e) => limpiar(e instanceof ErrorApi && e.estado !== 401 ? e.message : null));
  }, [cargarYo, limpiar]);

  const ingresar = useCallback(async (token: string) => {
    configurarSesion({ token, empresaId: null }); guardar('token', token); guardar('empresa', null);
    try { await cargarYo(null); }
    catch (e) { const m = e instanceof ErrorApi ? e.message : 'No se pudo ingresar.'; limpiar(m); throw e; }
  }, [cargarYo, limpiar]);

  const elegirEmpresa = useCallback(async (id: number | null) => { guardar('empresa', id ? String(id) : null); await cargarYo(id); }, [cargarYo]);
  const salir = useCallback(() => limpiar(null), [limpiar]);

  const permisos = useMemo(() => new Set(yo?.empresa_activa?.permisos ?? []), [yo]);
  const valor = useMemo<Valor>(() => ({ estado, yo, error, permisos, puede: (p) => permisos.has(p), ingresar, salir, elegirEmpresa }), [estado, yo, error, permisos, ingresar, salir, elegirEmpresa]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): Valor {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSesion fuera de ProveedorSesion');
  return v;
}
