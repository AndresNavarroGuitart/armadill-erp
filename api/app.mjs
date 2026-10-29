// API del sistema (primer tramo): sesión y empresa, clientes, proveedores, artículos y precios, y la factura de venta sin ARCA.
// Es un manejador de Node (req, res) sin framework: sirve igual dentro de Hono, Fastify o un servicio propio.
//   Cada pedido:  token → persona → empresa (X-Empresa-Id) → permiso → transacción con el contexto de sesión → respuesta.
//   Lo que cambia algo deja su rastro en la trazabilidad dentro de la misma transacción.
import { traducir, ErrorApi, noEncontrado } from './errores.mjs';
import { crearTercero, listarTerceros, obtenerTercero, modificarTercero } from './terceros.mjs';
import { crearArticulo, listarArticulos, leerArticulo, modificarArticulo, fijarPrecio, listarListas, crearLista } from './articulos.mjs';
import { calcularFactura, emitirFactura, listarComprobantes, leerComprobante } from './ventas.mjs';
import { registrarEvento } from './eventos.mjs';
import { crearLimitador } from '../asistente/http.mjs';

const json = (res, estado, cuerpo, cabeceras = {}) => { const t = JSON.stringify(cuerpo); res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(t), ...cabeceras }); res.end(t); };
async function leerCuerpo(req, maxBytes) {
  const partes = []; let total = 0;
  for await (const p of req) { total += p.length; if (total > maxBytes) throw new ErrorApi(413, 'demasiado_grande', 'El pedido es demasiado grande.'); partes.push(p); }
  const t = Buffer.concat(partes).toString('utf8');
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw new ErrorApi(400, 'json_invalido', 'El pedido no es un JSON válido.'); }
}
const id = (s) => (/^\d{1,15}$/.test(s) ? Number(s) : null);
const origenDe = (req) => ({ ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress, dispositivo: req.headers['user-agent'] });

/* Tabla de rutas: método, ruta, permiso, y qué hace. `c` es la conexión ya ubicada en la empresa. */
const RUTAS = [
  ['GET', '/api/clientes', 'clientes.ver', ({ c, q }) => listarTerceros(c, 'cliente', q)],
  ['POST', '/api/clientes', 'clientes.editar', async ({ c, ctx, cuerpo, origen }) => {
    const r = await crearTercero(c, ctx, 'cliente', cuerpo), t = r.tercero;
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: r.rolAgregado ? `Agregó el rol cliente a ${t.razon_social}` : `Dio de alta el cliente ${t.razon_social}`, detalle: `${t.tipo_documento} ${t.nro_documento}`, entidad: 'tercero', entidadId: t.id, origen });
    return { estado: r.creado ? 201 : 200, cuerpo: t };
  }],
  ['GET', '/api/clientes/:id', 'clientes.ver', ({ c, p }) => obtenerTercero(c, p.id, 'cliente')],
  ['PATCH', '/api/clientes/:id', 'clientes.editar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarTercero(c, ctx, 'cliente', p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Modificó el cliente ${r.tercero.razon_social}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'tercero', entidadId: p.id, cambios: r.cambios, origen });
    return r.tercero;
  }],
  ['GET', '/api/proveedores', 'proveedores.ver', ({ c, q }) => listarTerceros(c, 'proveedor', q)],
  ['POST', '/api/proveedores', 'proveedores.editar', async ({ c, ctx, cuerpo, origen }) => {
    const r = await crearTercero(c, ctx, 'proveedor', cuerpo), t = r.tercero;
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: r.rolAgregado ? `Agregó el rol proveedor a ${t.razon_social}` : `Dio de alta el proveedor ${t.razon_social}`, detalle: `${t.tipo_documento} ${t.nro_documento}`, entidad: 'tercero', entidadId: t.id, origen });
    return { estado: r.creado ? 201 : 200, cuerpo: t };
  }],
  ['GET', '/api/proveedores/:id', 'proveedores.ver', ({ c, p }) => obtenerTercero(c, p.id, 'proveedor')],
  ['PATCH', '/api/proveedores/:id', 'proveedores.editar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarTercero(c, ctx, 'proveedor', p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Modificó el proveedor ${r.tercero.razon_social}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'tercero', entidadId: p.id, cambios: r.cambios, origen });
    return r.tercero;
  }],
  ['GET', '/api/articulos', 'articulos.ver', ({ c, q }) => listarArticulos(c, q)],
  ['POST', '/api/articulos', 'articulos.editar', async ({ c, ctx, cuerpo, origen }) => {
    const a = await crearArticulo(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Dio de alta el artículo ${a.nombre}`, detalle: a.codigo, entidad: 'articulo', entidadId: a.id, origen });
    return { estado: 201, cuerpo: a };
  }],
  ['GET', '/api/articulos/:id', 'articulos.ver', ({ c, p }) => leerArticulo(c, p.id)],
  ['PATCH', '/api/articulos/:id', 'articulos.editar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarArticulo(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Modificó el artículo ${r.articulo.nombre}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'articulo', entidadId: p.id, cambios: r.cambios, origen });
    return r.articulo;
  }],
  ['PUT', '/api/articulos/:id/precios', 'articulos.editar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await fijarPrecio(c, ctx, p.id, cuerpo), a = await leerArticulo(c, p.id);
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Cambió el precio de ${a.nombre}`, detalle: r.cambio[0], entidad: 'articulo', entidadId: p.id, cambios: [r.cambio], origen });
    return { precios: r.precios };
  }],
  ['GET', '/api/listas-precio', 'articulos.ver', async ({ c }) => ({ datos: await listarListas(c) })],
  ['POST', '/api/listas-precio', 'articulos.editar', async ({ c, ctx, cuerpo, origen }) => {
    const l = await crearLista(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Creó la lista de precios ${l.nombre}`, entidad: 'lista_precio', entidadId: l.id, origen });
    return { estado: 201, cuerpo: l };
  }],
  ['POST', '/api/ventas/facturas/calcular', 'ventas.emitir', ({ c, ctx, cuerpo }) => calcularFactura(c, ctx, cuerpo)],
  ['POST', '/api/ventas/facturas', 'ventas.emitir', async ({ c, ctx, cuerpo, req }) => {
    const r = await emitirFactura(c, ctx, cuerpo, { claveIdempotencia: req.headers['idempotency-key'] });
    return { estado: r.repetido ? 200 : 201, cuerpo: { ...r.comprobante, avisos: r.avisos, repetido: r.repetido } };
  }],
  ['GET', '/api/comprobantes', 'ventas.ver', ({ c, q }) => listarComprobantes(c, q)],
  ['GET', '/api/comprobantes/:id', 'ventas.ver', ({ c, p }) => leerComprobante(c, p.id)],
].map(([metodo, ruta, permiso, hacer]) => ({ metodo, permiso, hacer, patron: new RegExp('^' + ruta.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));

export function crearApi({ bd, autenticar, origenesPermitidos = [], limitar = crearLimitador(240, 60_000), maxBytes = 64 * 1024, registrarError = () => {} }) {
  return async function manejador(req, res) {
    const base = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    const origen = req.headers.origin, permitido = origen && origenesPermitidos.includes(origen);
    if (permitido) Object.assign(base, { 'Access-Control-Allow-Origin': origen, Vary: 'Origin' });
    const responder = (estado, cuerpo, extra = {}) => json(res, estado, cuerpo, { ...base, ...extra });
    const fallar = (e) => { const t = traducir(e, registrarError); responder(t.estado, t.cuerpo); };
    try {
      const url = new URL(req.url, 'http://local'), ruta = url.pathname;
      if (req.method === 'OPTIONS') {
        if (!permitido) return responder(403, { error: { codigo: 'origen', mensaje: 'Origen no permitido.' } });
        res.writeHead(204, { ...base, 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Empresa-Id, Idempotency-Key', 'Access-Control-Max-Age': '600' }); return res.end();
      }
      if (ruta === '/api/salud' && req.method === 'GET') return responder(200, { ok: true });
      if (origen && !permitido) return responder(403, { error: { codigo: 'origen', mensaje: 'Origen no permitido.' } });

      const sesion = await autenticar(req);
      if (sesion.error === 'sin_sesion') return responder(401, { error: { codigo: 'sin_sesion', mensaje: 'Iniciá sesión para continuar.' } });
      if (sesion.error === 'sin_acceso') return responder(403, { error: { codigo: 'sin_acceso', mensaje: 'Tu usuario no tiene acceso al sistema. Pedile al administrador del estudio que te dé de alta.' } });
      if (sesion.error === 'empresa_invalida') return responder(403, { error: { codigo: 'empresa_invalida', mensaje: 'No tenés acceso a esa empresa.' } });
      const ctx = sesion.ctx;
      const tasa = limitar(`${ctx.estudioId}:${ctx.usuarioId}`);
      if (!tasa.permitido) return responder(429, { error: { codigo: 'demasiados_pedidos', mensaje: 'Demasiados pedidos seguidos. Esperá un momento.' } }, { 'Retry-After': String(tasa.reintentarEnSeg) });

      if (ruta === '/api/yo' && req.method === 'GET') {
        const empresas = await bd.sinContexto((c) => c.consultar('select * from fn_empresas_de($1)', [ctx.usuarioId]));
        return responder(200, { usuario: { id: ctx.usuarioId, nombre: ctx.nombre }, estudio_id: ctx.estudioId, empresa_activa: ctx.empresaId ? { id: ctx.empresaId, razon_social: ctx.empresa.razonSocial, cuit: ctx.empresa.cuit, rol: ctx.rol, permisos: [...ctx.permisos] } : null,
          empresas: empresas.map((e) => ({ id: e.empresa_id, razon_social: e.razon_social, cuit: e.cuit, condicion_iva_codigo: Number(e.condicion_iva_codigo), rol: e.rol })) });
      }

      let r = null, p = null;
      const coincidentes = RUTAS.filter((x) => x.patron.test(ruta));
      for (const x of coincidentes) if (x.metodo === req.method) { r = x; p = x.patron.exec(ruta).groups || {}; break; }
      if (!r) return coincidentes.length ? responder(405, { error: { codigo: 'metodo', mensaje: 'Método no permitido.' } }, { Allow: [...new Set(coincidentes.map((x) => x.metodo))].join(', ') }) : responder(404, { error: { codigo: 'no_existe', mensaje: 'No existe.' } });
      if (!ctx.empresaId) return responder(400, { error: { codigo: 'falta_empresa', mensaje: 'Indicá la empresa con el encabezado X-Empresa-Id.' } });
      if (!ctx.permisos.has(r.permiso)) return responder(403, { error: { codigo: 'sin_permiso', mensaje: 'No tenés permiso para hacer eso.' } });
      if ('id' in p) { p.id = id(p.id); if (p.id === null) throw noEncontrado(); }

      let cuerpo;
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return responder(415, { error: { codigo: 'tipo_contenido', mensaje: 'Se espera application/json.' } });
        cuerpo = await leerCuerpo(req, maxBytes);
      }
      const q = Object.fromEntries(url.searchParams);
      const salida = await bd.conContexto(ctx, (c) => r.hacer({ c, ctx, p, q, cuerpo, req, origen: origenDe(req) }));
      if (salida && salida.estado && salida.cuerpo !== undefined && Object.keys(salida).length === 2) return responder(salida.estado, salida.cuerpo);
      return responder(200, salida);
    } catch (e) { return fallar(e); }
  };
}
