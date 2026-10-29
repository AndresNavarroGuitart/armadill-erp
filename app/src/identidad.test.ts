import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearIdentidadDesarrollo, crearIdentidadSupabase, elegirIdentidad, traducirErrorAuth } from './identidad';

type Escuchador = (evento: string) => void;
function clienteFalso(sobre: Partial<{ sesion: { access_token: string } | null; errorIngreso: object | null; errorOtp: object | null; errorReset: object | null; errorClave: object | null }> = {}) {
  let escuchador: Escuchador | null = null;
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: sobre.sesion === undefined ? { access_token: 'tok-1' } : sobre.sesion } })),
    signInWithPassword: vi.fn(async () => ({ error: sobre.errorIngreso ?? null })),
    signInWithOtp: vi.fn(async () => ({ error: sobre.errorOtp ?? null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: sobre.errorReset ?? null })),
    updateUser: vi.fn(async () => ({ error: sobre.errorClave ?? null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn((f: Escuchador) => { escuchador = f; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
  };
  return { cliente: { auth } as unknown as SupabaseClient, auth, emitir: (e: string) => escuchador?.(e) };
}

describe('mensajes de error de ingreso', () => {
  it('están en castellano y no revelan detalles', () => {
    expect(traducirErrorAuth({ code: 'invalid_credentials', status: 400 })).toBe('El email o la contraseña no son correctos.');
    expect(traducirErrorAuth({ status: 400, message: 'Invalid login credentials' })).toBe('El email o la contraseña no son correctos.');
    expect(traducirErrorAuth({ code: 'over_email_send_rate_limit', status: 429 })).toMatch(/demasiados intentos/);
    expect(traducirErrorAuth({ code: 'weak_password', status: 422 })).toMatch(/12 caracteres/);
    expect(traducirErrorAuth({ code: 'email_not_confirmed' })).toMatch(/confirmar tu email/);
    expect(traducirErrorAuth({ message: 'TypeError: Failed to fetch' })).toMatch(/conectar/);
    const raro = traducirErrorAuth({ code: 'unexpected_failure', message: 'internal db error at 10.0.0.3' });
    expect(raro).not.toMatch(/10\.0\.0\.3|internal/); expect(raro).toMatch(/Intentá de nuevo/);
  });
});

describe('identidad con Supabase', () => {
  it('entrega el token vigente y null sin sesión', async () => {
    expect(await crearIdentidadSupabase(clienteFalso().cliente, 'https://app/').token()).toBe('tok-1');
    expect(await crearIdentidadSupabase(clienteFalso({ sesion: null }).cliente, 'https://app/').token()).toBeNull();
  });
  it('ingresa con el email sin espacios y traduce el error de credenciales', async () => {
    const ok = clienteFalso(); await crearIdentidadSupabase(ok.cliente, 'https://app/').ingresarConClave('  ana@estudio.com ', 'frase larga');
    expect(ok.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@estudio.com', password: 'frase larga' });
    const mal = clienteFalso({ errorIngreso: { code: 'invalid_credentials', status: 400 } });
    await expect(crearIdentidadSupabase(mal.cliente, 'https://app/').ingresarConClave('a@b.com', 'x')).rejects.toThrow('El email o la contraseña no son correctos.');
  });
  it('el enlace por email NO crea cuentas y no revela si el email existe', async () => {
    const f = clienteFalso({ errorOtp: { code: 'otp_disabled', status: 422 }, errorReset: { code: 'user_not_found', status: 404 } });
    const id = crearIdentidadSupabase(f.cliente, 'https://app/');
    await expect(id.enviarEnlace('nadie@x.com')).resolves.toBeUndefined();
    await expect(id.recuperarClave('nadie@x.com')).resolves.toBeUndefined();
    expect(f.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'nadie@x.com', options: { shouldCreateUser: false, emailRedirectTo: 'https://app/' } });
    expect(f.auth.resetPasswordForEmail).toHaveBeenCalledWith('nadie@x.com', { redirectTo: 'https://app/' });
  });
  it('sí informa cuando se llegó al límite de envíos', async () => {
    const f = clienteFalso({ errorOtp: { code: 'over_email_send_rate_limit', status: 429 } });
    await expect(crearIdentidadSupabase(f.cliente, 'https://app/').enviarEnlace('a@b.com')).rejects.toThrow(/demasiados intentos/);
  });
  it('avisa cuando se cierra la sesión o se vuelve de un enlace de recuperación, y deja de escuchar al desuscribirse', () => {
    const f = clienteFalso(); const eventos: string[] = [];
    const baja = crearIdentidadSupabase(f.cliente, 'https://app/').alCambiar((e) => eventos.push(e));
    f.emitir('SIGNED_IN'); f.emitir('TOKEN_REFRESHED'); f.emitir('SIGNED_OUT'); f.emitir('PASSWORD_RECOVERY');
    expect(eventos).toEqual(['cerrada', 'recuperacion']); expect(typeof baja).toBe('function');
  });
  it('cambia la contraseña y cierra la sesión del proveedor al salir', async () => {
    const f = clienteFalso(); const id = crearIdentidadSupabase(f.cliente, 'https://app/');
    await id.cambiarClave('una frase bastante larga'); expect(f.auth.updateUser).toHaveBeenCalledWith({ password: 'una frase bastante larga' });
    await id.salir(); expect(f.auth.signOut).toHaveBeenCalled();
    const flaca = clienteFalso({ errorClave: { code: 'weak_password', status: 422 } });
    await expect(crearIdentidadSupabase(flaca.cliente, 'https://app/').cambiarClave('corta')).rejects.toThrow(/12 caracteres/);
  });
});

describe('elección de la identidad', () => {
  it('sin configurar: personas de prueba solo en desarrollo; en producción, nada que permita ingresar', async () => {
    expect(elegirIdentidad({ DEV: true }, 'https://app/').tipo).toBe('desarrollo');
    const prod = elegirIdentidad({ DEV: false }, 'https://app/');
    expect(prod.tipo).toBe('ninguna'); expect(await prod.token()).toBeNull();
    await expect(prod.ingresarConClave('a@b.com', 'x')).rejects.toThrow(/no está configurado/);
  });
  it('la identidad de desarrollo guarda el token en memoria y avisa al salir', async () => {
    const id = crearIdentidadDesarrollo(); const eventos: string[] = []; id.alCambiar((e) => eventos.push(e));
    expect(await id.token()).toBeNull(); id.ingresarConToken?.('t-dev'); expect(await id.token()).toBe('t-dev');
    await id.salir(); expect(await id.token()).toBeNull(); expect(eventos).toEqual(['cerrada']);
    await expect(id.ingresarConClave('a@b.com', 'x')).rejects.toThrow();
  });
});
