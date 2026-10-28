// Capa HTTP del asistente: POST /api/asistente/mensajes con respuesta en streaming (SSE). No depende de ningún framework:
// recibe (req, res) de Node y sirve igual dentro de Hono, Fastify o un servicio propio.
//   - la autenticación se inyecta (en producción: valida el token de Supabase y arma el contexto de sesión);
//   - nunca se devuelven detalles internos ni trazas de error;
//   - el navegador solo puede llamar desde los orígenes permitidos.

export function crearLimitador(maximo = 10, ventanaMs = 60_000, reloj = () => Date.now()) {
  const llamadas = new Map();
  return (clave) => {
    const ahora = reloj(), vigentes = (llamadas.get(clave) || []).filter((t) => ahora - t < ventanaMs);
    if (vigentes.length >= maximo) { llamadas.set(clave, vigentes); return { permitido: false, reintentarEnSeg: Math.ceil((ventanaMs - (ahora - vigentes[0])) / 1000) }; }
    vigentes.push(ahora); llamadas.set(clave, vigentes); return { permitido: true };
  };
}

const json = (res, estado, cuerpo, extra = {}) => { res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(cuerpo)); };

async function leerCuerpo(req, maxBytes) {
  const partes = []; let total = 0;
  for await (const p of req) { total += p.length; if (total > maxBytes) throw Object.assign(new Error('grande'), { codigo: 413 }); partes.push(p); }
  return Buffer.concat(partes).toString('utf8');
}

export function crearManejador({ servicio, autenticar, origenesPermitidos = [], limitar = crearLimitador(), maxBytes = 32 * 1024, registrarError = () => {} }) {
  return async function manejador(req, res) {
    const base = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    const origen = req.headers.origin, permitido = origen && origenesPermitidos.includes(origen);
    if (permitido) Object.assign(base, { 'Access-Control-Allow-Origin': origen, Vary: 'Origin' });
    const url = new URL(req.url, 'http://local');

    if (req.method === 'OPTIONS') {
      if (!permitido) return json(res, 403, { error: 'Origen no permitido.' }, base);
      res.writeHead(204, { ...base, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' }); return res.end();
    }
    if (url.pathname === '/api/asistente/salud' && req.method === 'GET') return json(res, 200, { ok: true, guia: servicio.huella, secciones: servicio.secciones.length }, base);
    if (url.pathname !== '/api/asistente/mensajes') return json(res, 404, { error: 'No existe.' }, base);
    if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' }, { ...base, Allow: 'POST, OPTIONS' });
    if (origen && !permitido) return json(res, 403, { error: 'Origen no permitido.' }, base);
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Se espera application/json.' }, base);

    let ctx;
    try { ctx = await autenticar(req); } catch (e) { registrarError(e); ctx = null; }
    if (!ctx) return json(res, 401, { error: 'Iniciá sesión para usar el asistente.' }, base);
    if (!ctx.permisos || !ctx.permisos.has('asistente.usar')) return json(res, 403, { error: 'No tenés permiso para usar el asistente.' }, base);
    const tasa = limitar(`${ctx.estudioId}:${ctx.usuarioId}`);
    if (!tasa.permitido) return json(res, 429, { error: 'Demasiadas consultas seguidas. Esperá un momento.' }, { ...base, 'Retry-After': String(tasa.reintentarEnSeg) });

    let cuerpo;
    try { cuerpo = JSON.parse(await leerCuerpo(req, maxBytes)); }
    catch (e) { return json(res, e.codigo === 413 ? 413 : 400, { error: e.codigo === 413 ? 'El pedido es demasiado grande.' : 'El pedido no es un JSON válido.' }, base); }
    if (!cuerpo || typeof cuerpo !== 'object') return json(res, 400, { error: 'El pedido no es un JSON válido.' }, base);

    res.writeHead(200, { ...base, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const control = new AbortController();
    res.on('close', () => { if (!res.writableEnded) control.abort(); });
    const enviar = (ev) => res.write(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`);
    try {
      for await (const ev of servicio.conversar({ ctx, historial: cuerpo.historial, pregunta: cuerpo.pregunta, senal: control.signal })) { if (control.signal.aborted) break; enviar(ev); }
    } catch (e) {
      registrarError(e);
      if (!control.signal.aborted) enviar({ tipo: 'error', codigo: 'interno', mensaje: 'Algo salió mal. Probá de nuevo en un momento.' });
    }
    res.end();
  };
}
