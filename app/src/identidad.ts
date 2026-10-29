// Proveedor de identidad. Hay dos implementaciones con la misma forma:
//   - Supabase Auth (producción): el token lo emite y renueva Supabase; el front nunca ve ni guarda contraseñas.
//   - Desarrollo: personas de prueba que ofrece el servidor de desarrollo de la API (solo existen en `npm run dev`).
// El acceso al sistema NO lo da Supabase: una persona que se autentica pero no figura en `usuario` (alta hecha por el administrador del
// estudio) es rechazada por la API con "sin acceso". Por eso el alta de personas en Supabase está desactivada (ver app/LEEME.md).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type EventoIdentidad = 'cerrada' | 'recuperacion';
export type Identidad = {
  tipo: 'supabase' | 'desarrollo' | 'ninguna';
  /** Token vigente (se renueva solo) o null si no hay sesión. */
  token(): Promise<string | null>;
  ingresarConClave(email: string, clave: string): Promise<void>;
  enviarEnlace(email: string): Promise<void>;
  recuperarClave(email: string): Promise<void>;
  cambiarClave(nueva: string): Promise<void>;
  /** Solo desarrollo. */
  ingresarConToken?(token: string): void;
  salir(): Promise<void>;
  alCambiar(cb: (e: EventoIdentidad) => void): () => void;
};

/** Mensajes en castellano y sin revelar si un email existe o no. Lo que no se reconoce no se muestra tal cual (viene en inglés y con detalles). */
export function traducirErrorAuth(e: { code?: string; status?: number; message?: string } | null | undefined): string {
  const codigo = e?.code ?? '';
  if (codigo === 'email_not_confirmed') return 'Tenés que confirmar tu email antes de ingresar. Revisá tu casilla.';
  if (/rate_limit/.test(codigo) || e?.status === 429) return 'Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (codigo === 'weak_password') return 'La contraseña es muy débil. Usá al menos 12 caracteres, mejor una frase.';
  if (codigo === 'same_password') return 'La nueva contraseña tiene que ser distinta de la anterior.';
  if (codigo === 'invalid_credentials' || e?.status === 400) return 'El email o la contraseña no son correctos.';
  if (e?.status === 0 || /fetch|network/i.test(e?.message ?? '')) return 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.';
  return 'No se pudo completar la operación. Intentá de nuevo.';
}

const almacenamiento = (): Storage | null => { try { sessionStorage.setItem('_p', '1'); sessionStorage.removeItem('_p'); return sessionStorage; } catch { return null; } };

/** La sesión de Supabase se guarda en sessionStorage (muere con la pestaña), nunca en localStorage; sin almacenamiento, en memoria. */
function almacenDeSesion() {
  const memoria = new Map<string, string>(), s = almacenamiento();
  return { getItem: (k: string) => (s ? s.getItem(k) : memoria.get(k) ?? null), setItem: (k: string, v: string) => { if (s) s.setItem(k, v); else memoria.set(k, v); }, removeItem: (k: string) => { if (s) s.removeItem(k); else memoria.delete(k); } };
}

export function crearIdentidadSupabase(cliente: SupabaseClient, urlDeRetorno: string): Identidad {
  const falla = (e: unknown): never => { throw new Error(traducirErrorAuth(e as { code?: string })); };
  return {
    tipo: 'supabase',
    token: async () => (await cliente.auth.getSession()).data.session?.access_token ?? null,
    async ingresarConClave(email, clave) { const { error } = await cliente.auth.signInWithPassword({ email: email.trim(), password: clave }); if (error) falla(error); },
    // Para "enlace" y "olvidé": la respuesta es la misma exista o no la cuenta (no se revela quién está registrado); solo se informa un límite de envíos.
    async enviarEnlace(email) { const { error } = await cliente.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: urlDeRetorno } }); if (error && (error.status === 429 || /rate/.test(error.code ?? ''))) falla(error); },
    async recuperarClave(email) { const { error } = await cliente.auth.resetPasswordForEmail(email.trim(), { redirectTo: urlDeRetorno }); if (error && (error.status === 429 || /rate/.test(error.code ?? ''))) falla(error); },
    async cambiarClave(nueva) { const { error } = await cliente.auth.updateUser({ password: nueva }); if (error) falla(error); },
    async salir() { await cliente.auth.signOut(); },
    alCambiar(cb) {
      const { data } = cliente.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') cb('cerrada'); else if (evento === 'PASSWORD_RECOVERY') cb('recuperacion'); });
      return () => data.subscription.unsubscribe();
    },
  };
}

export function crearIdentidadDesarrollo(): Identidad {
  let token: string | null = null; const s = almacenamiento(); const oyentes = new Set<(e: EventoIdentidad) => void>();
  token = s?.getItem('token_dev') ?? null;
  const nada = async () => { throw new Error('El ingreso con usuario y contraseña no está configurado.'); };
  return {
    tipo: 'desarrollo', token: async () => token, ingresarConClave: nada, enviarEnlace: nada, recuperarClave: nada, cambiarClave: nada,
    ingresarConToken(t) { token = t; s?.setItem('token_dev', t); },
    async salir() { token = null; s?.removeItem('token_dev'); oyentes.forEach((f) => f('cerrada')); },
    alCambiar(cb) { oyentes.add(cb); return () => { oyentes.delete(cb); }; },
  };
}

const SIN_CONFIGURAR = (): Identidad => {
  const nada = async () => { throw new Error('El ingreso no está configurado en esta instalación.'); };
  return { tipo: 'ninguna', token: async () => null, ingresarConClave: nada, enviarEnlace: nada, recuperarClave: nada, cambiarClave: nada, salir: async () => {}, alCambiar: () => () => {} };
};

/** Con VITE_SUPABASE_URL y la clave publicable → Supabase. Sin configurar: personas de prueba solo en desarrollo; en un build de producción, nada. */
export function elegirIdentidad(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string; DEV?: boolean }, urlDeRetorno: string): Identidad {
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    const cliente = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: almacenDeSesion() } });
    return crearIdentidadSupabase(cliente, urlDeRetorno);
  }
  return env.DEV ? crearIdentidadDesarrollo() : SIN_CONFIGURAR();
}
