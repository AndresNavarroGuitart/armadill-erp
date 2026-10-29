// Cliente de la API. Un solo lugar sabe de encabezados y errores; las pantallas reciben datos o un ErrorApi con los campos.
export class ErrorApi extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string, public campos: Record<string, string> = {}) { super(mensaje); }
}
type Sesion = { obtenerToken: () => Promise<string | null>; empresaId: number | null; alVencer: () => void };
const sesion: Sesion = { obtenerToken: async () => null, empresaId: null, alVencer: () => {} };
export const configurarSesion = (cambios: Partial<Sesion>) => Object.assign(sesion, cambios);

type Consulta = Record<string, string | number | boolean | undefined | null>;
type Opciones = { cuerpo?: unknown; consulta?: Consulta; claveIdempotencia?: string; senal?: AbortSignal; sinEmpresa?: boolean };

export async function llamar<T>(metodo: string, ruta: string, op: Opciones = {}): Promise<T> {
  const q = op.consulta
    ? Object.entries(op.consulta).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const cabeceras: Record<string, string> = {};
  const token = await sesion.obtenerToken();                                       // el proveedor de identidad lo renueva solo cuando hace falta
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  if (sesion.empresaId && !op.sinEmpresa) cabeceras['X-Empresa-Id'] = String(sesion.empresaId);
  if (op.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (op.claveIdempotencia) cabeceras['Idempotency-Key'] = op.claveIdempotencia;
  let r: Response;
  try {
    r = await fetch(q ? `${ruta}?${q}` : ruta, { method: metodo, headers: cabeceras, body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo), signal: op.senal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErrorApi(0, 'sin_conexion', 'No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
  }
  const texto = await r.text();
  let json: unknown = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta que no es JSON */ }
  if (r.ok) return json as T;
  const e = (json as { error?: { codigo?: string; mensaje?: string; campos?: Record<string, string> } } | null)?.error;
  if (r.status === 401) sesion.alVencer();
  throw new ErrorApi(r.status, e?.codigo ?? 'error', e?.mensaje ?? (r.status === 429 ? 'Demasiados pedidos seguidos. Esperá unos segundos.' : 'Algo salió mal. Intentá de nuevo.'), e?.campos ?? {});
}
/** Descarga un archivo que genera el servidor (CSV): lo pide con la sesión puesta y lo entrega al navegador como descarga. El nombre lo sugiere el servidor. */
export async function descargar(ruta: string, consulta: Consulta, nombrePorDefecto: string): Promise<void> {
  const q = Object.entries(consulta).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const token = await sesion.obtenerToken();
  let r: Response;
  try { r = await fetch(q ? `${ruta}?${q}` : ruta, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(sesion.empresaId ? { 'X-Empresa-Id': String(sesion.empresaId) } : {}) } }); }
  catch { throw new ErrorApi(0, 'sin_conexion', 'No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.'); }
  if (!r.ok) {
    let e: { error?: { codigo?: string; mensaje?: string } } | null = null; try { e = await r.json(); } catch { /* sin cuerpo */ }
    if (r.status === 401) sesion.alVencer();
    throw new ErrorApi(r.status, e?.error?.codigo ?? 'error', e?.error?.mensaje ?? 'No se pudo descargar el archivo.');
  }
  const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? nombrePorDefecto;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const obtener = <T,>(ruta: string, consulta?: Consulta, senal?: AbortSignal) => llamar<T>('GET', ruta, { consulta, senal });
export const enviar = <T,>(metodo: 'POST' | 'PATCH' | 'PUT', ruta: string, cuerpo: unknown, extra: Omit<Opciones, 'cuerpo'> = {}) => llamar<T>(metodo, ruta, { ...extra, cuerpo });

/** Clave para que un doble clic o un reintento no emita dos veces: se genera al abrir el formulario, no al enviar. */
export const nuevaClave = (): string => `web-${crypto.randomUUID()}`;
