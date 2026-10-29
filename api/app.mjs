// API del sistema (primer tramo): sesión y empresa, clientes, proveedores, artículos y precios, y la factura de venta sin ARCA.
// Es un manejador de Node (req, res) sin framework: sirve igual dentro de Hono, Fastify o un servicio propio.
//   Cada pedido:  token → persona → empresa (X-Empresa-Id) → permiso → transacción con el contexto de sesión → respuesta.
//   Lo que cambia algo deja su rastro en la trazabilidad dentro de la misma transacción.
import { traducir, ErrorApi, noEncontrado, invalido } from './errores.mjs';
import { crearTercero, listarTerceros, obtenerTercero, modificarTercero } from './terceros.mjs';
import { crearArticulo, listarArticulos, leerArticulo, modificarArticulo, fijarPrecio } from './articulos.mjs';
import { listarListas, crearLista, modificarLista, eliminarLista, ajustarPrecios } from './listas.mjs';
import { listarDepositos, crearDeposito, modificarDeposito, listarExistencias, listarMovimientos, ajustarStock, transferirStock } from './stock.mjs';
import { calcularFactura, emitirFactura, listarComprobantes, leerComprobante } from './ventas.mjs';
import { registrarEvento } from './eventos.mjs';
import { prepararInvitacion, leerEstudio, modificarEstudio, listarPermisos, listarRoles, crearRol, fijarPermisosRol, listarPersonas, leerPersona, crearPersona, modificarPersona, fijarAccesos, listarEmpresas, leerEmpresa, crearEmpresa, modificarEmpresa } from './estudio.mjs';
import { anularComprobante, calcularNota, emitirNota, detalleComprobante } from './anulaciones.mjs';
import { calcularCompra, cargarCompra, listarCompras, listarCuentas, listarJurisdicciones } from './compras.mjs';
import { listarEventos, leerEvento, exportarEventos, verificarCadena } from './trazabilidad.mjs';
import { crearLimitador } from '../asistente/http.mjs';

const json = (res, estado, cuerpo, cabeceras = {}) => { const t = JSON.stringify(cuerpo); res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(t), ...cabeceras }); res.end(t); };
async function leerCuerpo(req, maxBytes) {
  const partes = []; let total = 0;
  for await (const p of req) { total += p.length; if (total > maxBytes) throw new ErrorApi(413, 'demasiado_grande', 'El pedido es demasiado grande.'); partes.push(p); }
  const t = Buffer.concat(partes).toString('utf8');
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw new ErrorApi(400, 'json_invalido', 'El pedido no es un JSON válido.'); }
}
const id = (s) => (/^\d{1,15}$/.test(s) ? Number(s) : null);
/* La IP queda en la trazabilidad: no puede ser lo que la persona escriba en un encabezado. Sin proxies de confianza (saltos = 0) es la de la
   conexión; con N proxies propios delante, es la que ESE último proxy anotó (el N-ésimo desde el final de X-Forwarded-For). */
const crearOrigenDe = (saltos) => (req) => {
  const cadena = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const ip = saltos > 0 && cadena.length >= saltos ? cadena[cadena.length - saltos] : req.socket.remoteAddress;
  return { ip, dispositivo: req.headers['user-agent'] };
};

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
  ['POST', '/api/listas-precio', 'listas.editar', async ({ c, ctx, cuerpo, origen }) => {
    const l = await crearLista(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Creó la lista de precios ${l.nombre}`, entidad: 'lista_precio', entidadId: l.id, origen });
    return { estado: 201, cuerpo: l };
  }],
  ['PATCH', '/api/listas-precio/:id', 'listas.editar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarLista(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Modificó la lista de precios ${r.lista.nombre}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'lista_precio', entidadId: p.id, cambios: r.cambios, origen });
    return r.lista;
  }],
  ['DELETE', '/api/listas-precio/:id', 'listas.editar', async ({ c, ctx, p, origen }) => {
    const l = await eliminarLista(c, p.id);
    await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Borró la lista de precios ${l.nombre}`, entidad: 'lista_precio', entidadId: p.id, origen });
    return { estado: 200, cuerpo: { borrada: true, nombre: l.nombre } };
  }],
  ['POST', '/api/listas-precio/:id/ajuste', 'listas.editar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await ajustarPrecios(c, ctx, p.id, cuerpo);
    if (r.aplicado) await registrarEvento(c, ctx, { categoria: 'maestros', accion: `Ajustó los precios de la lista ${r.lista}`, detalle: `${r.porcentaje} % desde ${r.vigente_desde} · ${r.cambian} artículos${r.bajo_costo ? ` · ${r.bajo_costo} quedaron bajo el costo` : ''}`, entidad: 'lista_precio', entidadId: p.id, origen });
    return r;
  }],
  // --- Stock ---
  ['GET', '/api/depositos', 'stock.ver', ({ c }) => listarDepositos(c)],
  ['GET', '/api/ventas/depositos', 'ventas.emitir', ({ c }) => listarDepositos(c)],        // para elegir de dónde sale la mercadería al facturar
  ['POST', '/api/depositos', 'stock.ajustar', async ({ c, ctx, cuerpo, origen }) => {
    const d = await crearDeposito(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'stock', accion: `Creó el depósito ${d.nombre}`, entidad: 'deposito', entidadId: d.id, origen });
    return { estado: 201, cuerpo: d };
  }],
  ['PATCH', '/api/depositos/:id', 'stock.ajustar', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarDeposito(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'stock', accion: r.cambios.some((x) => x[0] === 'activo') ? `${r.deposito.activo ? 'Reactivó' : 'Dio de baja'} el depósito ${r.deposito.nombre}` : `Modificó el depósito ${r.deposito.nombre}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'deposito', entidadId: p.id, cambios: r.cambios, origen });
    return r.deposito;
  }],
  ['GET', '/api/stock', 'stock.ver', ({ c, q }) => listarExistencias(c, q)],
  ['GET', '/api/stock/movimientos', 'stock.ver', ({ c, q }) => listarMovimientos(c, q)],
  ['POST', '/api/stock/ajustes', 'stock.ajustar', async ({ c, ctx, cuerpo, origen }) => {
    const r = await ajustarStock(c, ctx, cuerpo);
    const signo = Number(r.cantidad) > 0 ? '+' : '';
    await registrarEvento(c, ctx, { categoria: 'stock', accion: `Ajustó el stock de ${r.articulo.nombre}`, detalle: `${r.deposito}: ${signo}${r.cantidad} (${r.tipo === 'conteo' ? 'conteo' : r.tipo}) · ${r.saldo_antes} → ${r.saldo_despues}`, entidad: 'articulo', entidadId: r.articulo.id, origen });
    return { estado: 201, cuerpo: r };
  }],
  ['POST', '/api/stock/transferencias', 'stock.ajustar', async ({ c, ctx, cuerpo, origen }) => {
    const r = await transferirStock(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'stock', accion: `Transfirió stock de ${r.articulo.nombre}`, detalle: `${r.cantidad} de ${r.origen} a ${r.destino}`, entidad: 'articulo', entidadId: r.articulo.id, origen });
    return { estado: 201, cuerpo: r };
  }],
  ['POST', '/api/ventas/facturas/calcular', 'ventas.emitir', ({ c, ctx, cuerpo }) => calcularFactura(c, ctx, cuerpo)],
  ['POST', '/api/ventas/facturas', 'ventas.emitir', async ({ c, ctx, cuerpo, req }) => {
    const r = await emitirFactura(c, ctx, cuerpo, { claveIdempotencia: req.headers['idempotency-key'] });
    return { estado: r.repetido ? 200 : 201, cuerpo: { ...r.comprobante, avisos: r.avisos, repetido: r.repetido } };
  }],
  ['GET', '/api/comprobantes', 'ventas.ver', ({ c, q }) => listarComprobantes(c, { ...q, sentido: 'venta' })],      // las compras tienen su propio permiso y su propia ruta
  ['GET', '/api/comprobantes/:id', 'ventas.ver', ({ c, p }) => detalleComprobante(c, p.id, { sentido: 'venta' })],
  // --- Compras ---
  ['GET', '/api/compras/facturas', 'compras.ver', ({ c, q }) => listarCompras(c, q)],
  ['POST', '/api/compras/facturas/calcular', 'compras.cargar', ({ c, ctx, cuerpo }) => calcularCompra(c, ctx, cuerpo)],
  ['POST', '/api/compras/facturas', 'compras.cargar', async ({ c, ctx, cuerpo }) => {
    const r = await cargarCompra(c, ctx, cuerpo);
    return { estado: 201, cuerpo: { ...r.comprobante, avisos: r.avisos } };
  }],
  ['GET', '/api/compras/facturas/:id', 'compras.ver', ({ c, p }) => detalleComprobante(c, p.id, { sentido: 'compra' })],
  ['POST', '/api/compras/facturas/:id/anular', 'compras.anular', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await anularComprobante(c, ctx, p.id, cuerpo, { sentido: 'compra' });
    await registrarEvento(c, ctx, { categoria: 'comprobantes', accion: `Anuló ${r.etiqueta} de compra`, detalle: `${r.cliente} · $ ${r.total} · motivo: ${r.motivo}${r.stock ? ` · sacó ${r.stock} movimientos de stock` : ''}`, entidad: 'comprobante', entidadId: p.id, origen });
    return r.comprobante;
  }],
  ['GET', '/api/plan-cuentas', 'compras.ver', ({ c, q }) => listarCuentas(c, q)],
  ['GET', '/api/catalogos/jurisdicciones', 'compras.ver', ({ c }) => listarJurisdicciones(c)],
  ['POST', '/api/comprobantes/:id/anular', 'ventas.anular', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await anularComprobante(c, ctx, p.id, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'comprobantes', accion: `Anuló ${r.etiqueta}`, detalle: `${r.cliente} · $ ${r.total} · motivo: ${r.motivo}${r.stock ? ` · devolvió ${r.stock} movimientos de stock` : ''}`, entidad: 'comprobante', entidadId: p.id, origen });
    return r.comprobante;
  }],
  ['POST', '/api/ventas/notas-credito/calcular', 'ventas.emitir', ({ c, ctx, cuerpo }) => calcularNota(c, ctx, cuerpo)],
  ['POST', '/api/ventas/notas-credito', 'ventas.emitir', async ({ c, ctx, cuerpo, req }) => {
    const r = await emitirNota(c, ctx, cuerpo, { claveIdempotencia: req.headers['idempotency-key'] });
    return { estado: r.repetido ? 200 : 201, cuerpo: { ...r.comprobante, avisos: r.avisos, repetido: r.repetido } };
  }],
  // --- Trazabilidad del estudio (solo administradores). Las rutas fijas van ANTES de /:id ---
  ['GET', '/api/estudio/trazabilidad', '@estudio', ({ c, q }) => listarEventos(c, q)],
  ['GET', '/api/estudio/trazabilidad/exportar', '@estudio', async ({ c, ctx, q, origen }) => {
    const r = await exportarEventos(c, q);
    await registrarEvento(c, ctx, { categoria: 'seguridad', accion: 'Exportó la trazabilidad a CSV', detalle: `${r.filas} eventos${r.filtros ? ` · ${r.filtros}` : ''}`, origen });
    return { csv: r.csv, nombre: r.nombre };
  }],
  ['POST', '/api/estudio/trazabilidad/verificar', '@estudio', async ({ c, ctx, cuerpo, origen }) => {
    const r = await verificarCadena(c, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'seguridad', accion: `Verificó la integridad de la trazabilidad: ${r.integra ? 'íntegra' : 'CON PROBLEMAS'}`, detalle: `${r.eventos} eventos${r.primer_evento_roto ? ` · se rompe en el ${r.primer_evento_roto}` : ''}${r.resguardo ? ` · contra la cabeza guardada: ${r.resguardo.coincide ? 'coincide' : 'NO coincide'}` : ''}`, origen, resultado: r.integra ? 'ok' : 'fallo' });
    return r;
  }],
  ['GET', '/api/estudio/trazabilidad/:id', '@estudio', ({ c, p }) => leerEvento(c, p.id)],
  // --- Administración del estudio (solo administradores del estudio; sin empresa activa) ---
  ['GET', '/api/estudio', '@estudio', async ({ c, invitador }) => ({ ...(await leerEstudio(c)), invitaciones: !!invitador })],
  ['PATCH', '/api/estudio', '@estudio', async ({ c, ctx, cuerpo, origen }) => {
    const r = await modificarEstudio(c, ctx, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'maestros', accion: 'Modificó los datos del estudio', detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'estudio', entidadId: ctx.estudioId, cambios: r.cambios, origen });
    return r.estudio;
  }],
  ['GET', '/api/estudio/permisos', '@estudio', ({ c }) => listarPermisos(c)],
  ['GET', '/api/estudio/roles', '@estudio', ({ c }) => listarRoles(c)],
  ['POST', '/api/estudio/roles', '@estudio', async ({ c, ctx, cuerpo, origen }) => {
    const { rol } = await crearRol(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'seguridad', accion: `Creó el rol ${rol.nombre}`, detalle: `${rol.permisos.length} permisos`, entidad: 'rol', entidadId: rol.id, origen });
    return { estado: 201, cuerpo: rol };
  }],
  ['PUT', '/api/estudio/roles/:id/permisos', '@estudio', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await fijarPermisosRol(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'seguridad', accion: `Cambió los permisos del rol ${r.rol.nombre}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'rol', entidadId: p.id, cambios: r.cambios, origen });
    return r.rol;
  }],
  ['GET', '/api/estudio/personas', '@estudio', ({ c, q }) => listarPersonas(c, q)],
  ['POST', '/api/estudio/personas', '@estudio', async ({ c, ctx, cuerpo, origen }) => {
    const persona = await crearPersona(c, ctx, cuerpo);
    await registrarEvento(c, ctx, { categoria: 'seguridad', accion: `Dio de alta a la persona ${persona.nombre}`, detalle: `${persona.email} · ${persona.accesos.length} empresas${persona.admin_estudio ? ' · administradora del estudio' : ''}`, entidad: 'usuario', entidadId: persona.id, origen });
    return { estado: 201, cuerpo: persona };
  }],
  // Invitar a una persona a crear su cuenta de ingreso. NO corre dentro de una transacción de la base (hay una llamada de red en el medio):
  // primero se comprueba, después se invita, y recién entonces se deja constancia. El email sale de la persona cargada, nunca del pedido.
  ['POST', '/api/estudio/personas/:id/invitacion', '@estudio', async ({ bd, ctx, p, cuerpo, origen, invitador }) => {
    if (!invitador) throw new ErrorApi(501, 'invitaciones_no_configuradas', 'Esta instalación todavía no envía invitaciones desde el sistema. Invitá a la persona desde el panel de Supabase, con el mismo email.');
    if (cuerpo && Object.keys(cuerpo).length) throw invalido({ _: 'Este pedido no lleva datos: el email sale de la persona cargada.' });
    const persona = await bd.conContexto(ctx, (c) => prepararInvitacion(c, p.id));
    let r = null, fallo = null;
    try { r = await invitador.invitar(persona.email); } catch (e) { fallo = e; }
    await bd.conContexto(ctx, (c) => registrarEvento(c, ctx, fallo
      ? { categoria: 'seguridad', accion: `Intentó invitar a ${persona.nombre}`, detalle: persona.email, entidad: 'usuario', entidadId: persona.id, origen, resultado: 'fallo' }
      : { categoria: 'seguridad', accion: `Invitó a ${persona.nombre}`, detalle: `${persona.email} · ${r.estado === 'ya_tiene_cuenta' ? 'ya tenía cuenta de ingreso' : 'invitación enviada'}`, entidad: 'usuario', entidadId: persona.id, origen }));
    if (fallo) throw fallo;
    return { estado: r.estado, email: persona.email, mensaje: r.estado === 'ya_tiene_cuenta' ? 'Esa persona ya tiene una cuenta de ingreso: puede entrar con su contraseña o pedir un enlace por email.' : `Le enviamos una invitación a ${persona.email}.` };
  }, { propia: true }],
  ['GET', '/api/estudio/personas/:id', '@estudio', ({ c, p }) => leerPersona(c, p.id)],
  ['PATCH', '/api/estudio/personas/:id', '@estudio', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarPersona(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'seguridad', accion: `Modificó a la persona ${r.persona.nombre}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'usuario', entidadId: p.id, cambios: r.cambios, origen });
    return r.persona;
  }],
  ['PUT', '/api/estudio/personas/:id/accesos', '@estudio', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await fijarAccesos(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, ctx, { categoria: 'seguridad', accion: `Cambió los accesos de ${r.persona.nombre}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'usuario', entidadId: p.id, cambios: r.cambios, origen });
    return r.persona;
  }],
  ['GET', '/api/estudio/empresas', '@estudio', ({ c, q }) => listarEmpresas(c, q)],
  ['POST', '/api/estudio/empresas', '@estudio', async ({ c, ctx, cuerpo, origen }) => {
    const e = await crearEmpresa(c, ctx, cuerpo);
    await registrarEvento(c, { ...ctx, empresaId: e.id }, { categoria: 'maestros', accion: `Dio de alta la empresa ${e.razon_social}`, detalle: `CUIT ${e.cuit}`, entidad: 'empresa', entidadId: e.id, origen });
    return { estado: 201, cuerpo: e };
  }],
  ['GET', '/api/estudio/empresas/:id', '@estudio', ({ c, p }) => leerEmpresa(c, p.id)],
  ['PATCH', '/api/estudio/empresas/:id', '@estudio', async ({ c, ctx, p, cuerpo, origen }) => {
    const r = await modificarEmpresa(c, ctx, p.id, cuerpo);
    if (r.cambios.length) await registrarEvento(c, { ...ctx, empresaId: p.id }, { categoria: 'maestros', accion: r.cambios.some((x) => x[0] === 'activa') ? `${r.empresa.activa ? 'Reactivó' : 'Dio de baja'} la empresa ${r.empresa.razon_social}` : `Modificó la empresa ${r.empresa.razon_social}`, detalle: r.cambios.map((x) => x[0]).join(', '), entidad: 'empresa', entidadId: p.id, cambios: r.cambios, origen });
    return r.empresa;
  }],
].map(([metodo, ruta, permiso, hacer, opciones = {}]) => ({ metodo, permiso, hacer, propia: !!opciones.propia, patron: new RegExp('^' + ruta.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));

const esAdminEstudio = async (bd, ctx) => !!(await bd.conContexto({ ...ctx, empresaId: null }, (c) => c.uno('select 1 x from usuario where id = fn_usuario_actual() and admin_estudio and activo')));

export function crearApi({ bd, autenticar, origenesPermitidos = [], limitar = crearLimitador(240, 60_000), maxBytes = 64 * 1024, saltosDeProxy = 0, invitador = null, registrarError = () => {} }) {
  const origenDe = crearOrigenDe(saltosDeProxy);
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
        res.writeHead(204, { ...base, 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Empresa-Id, Idempotency-Key', 'Access-Control-Max-Age': '600' }); return res.end();
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
        return responder(200, { usuario: { id: ctx.usuarioId, nombre: ctx.nombre }, estudio_id: ctx.estudioId, admin_estudio: await esAdminEstudio(bd, ctx), empresa_activa: ctx.empresaId ? { id: ctx.empresaId, razon_social: ctx.empresa.razonSocial, cuit: ctx.empresa.cuit, condicion_iva_codigo: Number(ctx.empresa.condicionIvaCodigo), rol: ctx.rol, permisos: [...ctx.permisos] } : null,
          empresas: empresas.map((e) => ({ id: e.empresa_id, razon_social: e.razon_social, cuit: e.cuit, condicion_iva_codigo: Number(e.condicion_iva_codigo), rol: e.rol })) });
      }

      let r = null, p = null;
      const coincidentes = RUTAS.filter((x) => x.patron.test(ruta));
      for (const x of coincidentes) if (x.metodo === req.method) { r = x; p = x.patron.exec(ruta).groups || {}; break; }
      if (!r) return coincidentes.length ? responder(405, { error: { codigo: 'metodo', mensaje: 'Método no permitido.' } }, { Allow: [...new Set(coincidentes.map((x) => x.metodo))].join(', ') }) : responder(404, { error: { codigo: 'no_existe', mensaje: 'No existe.' } });
      const delEstudio = r.permiso === '@estudio', ctxTrabajo = delEstudio ? { ...ctx, empresaId: null } : ctx;          // la administración del estudio no depende de una empresa
      if (!delEstudio && !ctx.empresaId) return responder(400, { error: { codigo: 'falta_empresa', mensaje: 'Indicá la empresa con el encabezado X-Empresa-Id.' } });
      if (delEstudio ? !(await esAdminEstudio(bd, ctxTrabajo)) : !ctx.permisos.has(r.permiso)) return responder(403, { error: { codigo: 'sin_permiso', mensaje: delEstudio ? 'Solo los administradores del estudio pueden hacer eso.' : 'No tenés permiso para hacer eso.' } });
      if ('id' in p) { p.id = id(p.id); if (p.id === null) throw noEncontrado(); }

      let cuerpo;
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return responder(415, { error: { codigo: 'tipo_contenido', mensaje: 'Se espera application/json.' } });
        cuerpo = await leerCuerpo(req, maxBytes);
      }
      const q = Object.fromEntries(url.searchParams);
      const salida = r.propia
        ? await r.hacer({ bd, ctx: ctxTrabajo, p, q, cuerpo, req, origen: origenDe(req), invitador })
        : await bd.conContexto(ctxTrabajo, (c) => r.hacer({ c, ctx: ctxTrabajo, p, q, cuerpo, req, origen: origenDe(req), invitador }));
      if (salida && typeof salida.csv === 'string') {      // descarga: el archivo se arma con un BOM para que Excel lea bien los acentos
        res.writeHead(200, { ...base, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${salida.nombre}"` });
        return res.end('\ufeff' + salida.csv);
      }
      if (salida && salida.estado && salida.cuerpo !== undefined && Object.keys(salida).length === 2) return responder(salida.estado, salida.cuerpo);
      return responder(200, salida);
    } catch (e) { return fallar(e); }
  };
}
