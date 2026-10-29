// Piezas de interfaz compartidas: campos con error por campo, modal accesible, avisos y estados vacíos.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ErrorApi } from './api';

/* ---------- campos ---------- */
type Comun = { etiqueta: string; error?: string; ayuda?: string };
export function Campo({ etiqueta, error, ayuda, ...props }: Comun & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`campo${error ? ' con-error' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error || ayuda ? `${id}-m` : undefined} {...props} />
      {(error || ayuda) && <small id={`${id}-m`} className={error ? 'error' : 'ayuda'}>{error ?? ayuda}</small>}
    </div>
  );
}
export function Selector({ etiqueta, error, ayuda, children, ...props }: Comun & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={`campo${error ? ' con-error' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <select id={id} aria-invalid={!!error} aria-describedby={error || ayuda ? `${id}-m` : undefined} {...props}>{children}</select>
      {(error || ayuda) && <small id={`${id}-m`} className={error ? 'error' : 'ayuda'}>{error ?? ayuda}</small>}
    </div>
  );
}

/** Errores de la API que no pertenecen a ningún campo visible (para mostrarlos arriba del formulario). */
export function resumenErrores(e: unknown, visibles: string[]): string | null {
  if (!(e instanceof ErrorApi)) return e ? 'Algo salió mal. Intentá de nuevo.' : null;
  const sueltos = Object.entries(e.campos).filter(([k]) => !visibles.includes(k)).map(([k, m]) => `${k}: ${m}`);
  return sueltos.length ? `${e.message} ${sueltos.join(' · ')}` : e.message;
}
export const Alerta = ({ tipo = 'error', children }: { tipo?: 'error' | 'aviso' | 'info'; children: ReactNode }) => <div className={`alerta ${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>{children}</div>;
export const Cargando = ({ texto = 'Cargando…' }: { texto?: string }) => <div className="cargando" role="status"><i />{texto}</div>;
export const Vacio = ({ titulo, children }: { titulo: string; children?: ReactNode }) => <div className="vacio"><strong>{titulo}</strong>{children && <p>{children}</p>}</div>;
export const Etiqueta = ({ tono = 'neutro', children }: { tono?: 'neutro' | 'ok' | 'aviso' | 'malo' | 'info'; children: ReactNode }) => <span className={`etiqueta ${tono}`}>{children}</span>;

/* ---------- modal ---------- */
export function Modal({ titulo, onCerrar, children, ancho = 560 }: { titulo: string; onCerrar: () => void; children: ReactNode; ancho?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (!d.open) d.showModal();
    const cerrar = (ev: Event) => { ev.preventDefault(); onCerrar(); };
    d.addEventListener('cancel', cerrar);
    return () => d.removeEventListener('cancel', cerrar);
  }, [onCerrar]);
  return (
    <dialog ref={ref} className="modal" style={{ width: `min(${ancho}px, calc(100vw - 24px))` }} aria-label={titulo}
      onMouseDown={(e) => { if (e.target === ref.current) onCerrar(); }}>
      <div className="modal-cab"><h2>{titulo}</h2><button className="icono" onClick={onCerrar} aria-label="Cerrar">×</button></div>
      <div className="modal-cuerpo">{children}</div>
    </dialog>
  );
}

/* ---------- avisos ---------- */
type Aviso = { id: number; texto: string; tono: 'ok' | 'error' };
const ContextoAvisos = createContext<(texto: string, tono?: 'ok' | 'error') => void>(() => {});
export const useAviso = () => useContext(ContextoAvisos);
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((texto: string, tono: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tono }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}
      <div className="avisos" aria-live="polite">{avisos.map((a) => <div key={a.id} className={`aviso ${a.tono}`}>{a.texto}</div>)}</div>
    </ContextoAvisos.Provider>
  );
}

/** Retrasa un valor (para buscar mientras se escribe sin pedir en cada tecla). */
export function useRetraso<T>(valor: T, ms = 250): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

/** Campo de búsqueda con lista de resultados (flechas, Enter y Escape). */
export function Buscador<T extends { id: number }>({ etiqueta, texto, onTexto, buscar, mostrar, onElegir, error, placeholder, autoFocus }: {
  etiqueta: string; texto: string; onTexto: (t: string) => void; buscar: (q: string) => Promise<T[]>; mostrar: (t: T) => ReactNode; onElegir: (t: T) => void; error?: string; placeholder?: string; autoFocus?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [res, setRes] = useState<T[]>([]);
  const [cursor, setCursor] = useState(0);
  const q = useRetraso(texto, 200);
  const buscarRef = useRef(buscar); buscarRef.current = buscar;
  useEffect(() => { if (!abierto) return; let vivo = true; buscarRef.current(q.trim()).then((r) => { if (vivo) { setRes(r); setCursor(0); } }).catch(() => { if (vivo) setRes([]); }); return () => { vivo = false; }; }, [q, abierto]);
  const elegir = (t: T) => { onElegir(t); setAbierto(false); };
  return (
    <div className="sugerencias" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAbierto(false); }}>
      <Campo etiqueta={etiqueta} value={texto} error={error} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" role="combobox" aria-expanded={abierto} aria-autocomplete="list"
        onChange={(e) => { onTexto(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setCursor((c) => Math.min(c + 1, res.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === 'Enter' && abierto && res[cursor]) { e.preventDefault(); elegir(res[cursor]); }
          else if (e.key === 'Escape') setAbierto(false);
        }} />
      {abierto && res.length > 0 && (
        <ul role="listbox">{res.map((t, i) => <li key={t.id}><button type="button" role="option" aria-selected={i === cursor} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(t)}>{mostrar(t)}</button></li>)}</ul>
      )}
    </div>
  );
}

