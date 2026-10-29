// Configuración del servidor de producción, desde variables de entorno. Falla con TODOS los problemas juntos (no de a uno) y antes de
// abrir ningún puerto: un servidor mal configurado no debe arrancar a medias. Nada de esto tiene valores por defecto inseguros.
const ESLOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function leerConfiguracion(env = process.env) {
  const errores = [];
  const pedir = (nombre, ayuda) => { const v = (env[nombre] ?? '').trim(); if (!v) errores.push(`${nombre}: falta (${ayuda})`); return v; };
  const entero = (nombre, porDefecto, min, max) => {
    const crudo = (env[nombre] ?? '').trim(); if (!crudo) return porDefecto;
    const n = Number(crudo); if (!Number.isInteger(n) || n < min || n > max) { errores.push(`${nombre}: tiene que ser un entero entre ${min} y ${max}`); return porDefecto; }
    return n;
  };

  const baseDeDatos = pedir('DATABASE_URL', 'cadena de conexión de la base, con el usuario dueño');
  if (baseDeDatos && !/^postgres(ql)?:\/\//.test(baseDeDatos)) errores.push('DATABASE_URL: tiene que empezar con postgres:// o postgresql://');

  // Certificado de la autoridad que firma el de la base (Supabase publica el suyo): PEM; los saltos de línea pueden venir escritos como "\n".
  const baseDeDatosCa = (env.DATABASE_CA ?? '').replace(/\\n/g, '\n').trim();
  if (baseDeDatosCa && !/-----BEGIN CERTIFICATE-----/.test(baseDeDatosCa)) errores.push('DATABASE_CA: tiene que ser un certificado en formato PEM');

  let emisor = (env.JWT_EMISOR ?? '').trim(), jwksUrl = (env.JWT_JWKS_URL ?? '').trim();
  const supabase = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (supabase) {
    let u; try { u = new URL(supabase); } catch (e) { errores.push('SUPABASE_URL: no es una dirección válida'); }
    if (u && u.protocol !== 'https:' && !ESLOCAL.test(u.hostname)) errores.push('SUPABASE_URL: tiene que ser https');
    emisor ||= `${supabase}/auth/v1`; jwksUrl ||= `${emisor}/.well-known/jwks.json`;
  }
  const secretoHS256 = (env.SUPABASE_JWT_SECRET ?? '').trim();
  if (!jwksUrl && !secretoHS256) errores.push('SUPABASE_URL: falta (de ahí salen el emisor y las claves públicas para verificar el ingreso; o bien SUPABASE_JWT_SECRET para el secreto heredado)');
  if (secretoHS256 && secretoHS256.length < 32) errores.push('SUPABASE_JWT_SECRET: es demasiado corto para ser un secreto real');
  if (!emisor) errores.push('JWT_EMISOR: falta (o indicá SUPABASE_URL, que lo completa)');
  if (jwksUrl && !/^https:\/\//.test(jwksUrl) && !ESLOCAL.test(new URL(jwksUrl, 'http://x').hostname)) errores.push('JWT_JWKS_URL: tiene que ser https');

  const origenes = pedir('ORIGENES', 'direcciones desde las que se usa el front, separadas por coma, ej. https://app.ejemplo.com').split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of origenes) {
    let u; try { u = new URL(o); } catch (e) { errores.push(`ORIGENES: "${o}" no es una dirección válida`); continue; }
    if (!/^https?:$/.test(u.protocol) || u.origin !== o) errores.push(`ORIGENES: "${o}" tiene que ser solo el origen (esquema + dominio, sin barra final ni ruta)`);
    else if (u.protocol === 'http:' && !ESLOCAL.test(u.hostname)) errores.push(`ORIGENES: "${o}" tiene que ser https (http solo para localhost)`);
  }

  // Invitaciones desde la aplicación (opcional). La clave de servicio puede TODO sobre las cuentas: solo se acepta una clave de servicio,
  // nunca la publicable, y nunca sin saber a qué proyecto apunta.
  const claveServicio = (env.SUPABASE_SERVICE_KEY ?? '').trim();
  let urlApp = (env.URL_APP ?? '').trim() || origenes[0] || '';
  if (claveServicio) {
    if (!supabase) errores.push('SUPABASE_SERVICE_KEY: hace falta SUPABASE_URL para saber a qué proyecto pertenece');
    if (/^sb_publishable_/.test(claveServicio) || claveServicio.length < 20) errores.push('SUPABASE_SERVICE_KEY: no parece una clave de servicio (la "secret" o "service_role"); la "publishable" o "anon" no sirve para invitar');
    let u; try { u = new URL(urlApp); } catch (e) { errores.push('URL_APP: dirección de la aplicación a la que llega la invitación (por defecto, el primer ORIGENES)'); }
    if (u && (u.search || u.hash || u.username || u.password)) errores.push('URL_APP: tiene que ser la dirección de la aplicación, sin parámetros ni usuario');
    if (u && u.protocol === 'http:' && !ESLOCAL.test(u.hostname)) errores.push('URL_APP: tiene que ser https');
  }

  const config = {
    puerto: entero('PORT', 8080, 1, 65535), escucharEn: (env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
    baseDeDatos, baseDeDatosCa: baseDeDatosCa || null, poolMaximo: entero('POOL_MAX', 10, 1, 100), saltosDeProxy: entero('TRUST_PROXY_HOPS', 0, 0, 5),
    jwt: { emisor, jwksUrl: jwksUrl || null, secretoHS256: secretoHS256 || null, audiencia: (env.JWT_AUDIENCIA ?? 'authenticated').trim() || 'authenticated' },
    invitaciones: claveServicio ? { url: supabase, claveServicio, urlRetorno: urlApp } : null,
    origenes, limitePorMinuto: entero('LIMITE_POR_MINUTO', 240, 10, 100000),
  };
  if (errores.length) { const e = new Error(`Configuración incompleta o inválida:\n  - ${errores.join('\n  - ')}`); e.errores = errores; throw e; }
  return config;
}
