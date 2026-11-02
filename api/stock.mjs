// Stock: depósitos, existencias, libro de movimientos, ajustes de inventario y transferencias entre depósitos.
// El stock es un libro de SOLO AGREGAR (movimiento_stock): el saldo se deriva y un error se corrige con el movimiento contrario, nunca editando.
// La base impide el saldo negativo (salvo que la empresa lo permita); acá se comprueba antes para dar un mensaje con nombres y cantidades.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { dec, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const cantidadTexto = (x) => texto(dec(x), 4).replace(/\.?0+$/, '');   // 5.0000 → 5, 2.5000 → 2.5

/* ---------- depósitos ---------- */
const SELECT_DEPOSITO = `select d.id, d.nombre, d.activo, (select count(distinct m.articulo_id)::int from movimiento_stock m where m.deposito_id = d.id
    and (select sum(m2.cantidad) from movimiento_stock m2 where m2.deposito_id = d.id and m2.articulo_id = m.articulo_id) <> 0) as articulos_con_stock from deposito d`;
export async function listarDepositos(c) { return { datos: await c.consultar(`${SELECT_DEPOSITO} order by d.nombre`) }; }
async function leerDeposito(c, id) { const d = await c.uno(`${SELECT_DEPOSITO} where d.id = $1`, [id]); if (!d) throw noEncontrado('El depósito'); return d; }

export async function crearDeposito(c, ctx, cuerpo) {
  const { valor } = validar({ nombre: { tipo: 'texto', min: 2, max: 60, requerido: true } }, cuerpo);
  if (await c.uno('select 1 x from deposito where lower(nombre) = lower($1)', [valor.nombre])) throw new ErrorApi(409, 'duplicado', 'Ya existe un depósito con ese nombre.');
  const r = await c.uno('insert into deposito (empresa_id, nombre) values ($1, $2) returning id', [ctx.empresaId, valor.nombre]);
  return leerDeposito(c, r.id);
}
export async function modificarDeposito(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ nombre: { tipo: 'texto', min: 2, max: 60 }, activo: { tipo: 'booleano' } }, cuerpo, { parcial: true });
  if (!Object.keys(d).length) throw invalido({ _: 'No hay nada para modificar.' });
  const antes = await leerDeposito(c, id);
  if (d.nombre !== undefined && await c.uno('select 1 x from deposito where lower(nombre) = lower($1) and id <> $2', [d.nombre, id])) throw new ErrorApi(409, 'duplicado', 'Ya existe un depósito con ese nombre.');
  const cambios = ['nombre', 'activo'].filter((k) => k in d && d[k] !== antes[k]).map((k) => [k, String(antes[k]), String(d[k])]);
  // Que no se pueda dar de baja con existencias, ni el último activo, lo impone la base (trigger): el mensaje sale de ahí.
  if (cambios.length) await c.consultar('update deposito set nombre = coalesce($2, nombre), activo = coalesce($3, activo) where id = $1', [id, d.nombre ?? null, d.activo ?? null]);
  return { deposito: await leerDeposito(c, id), cambios };
}

/* ---------- existencias ---------- */
export async function listarExistencias(c, { q, bajo_minimo, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0);
  const patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null, bajo = bajo_minimo === true || bajo_minimo === 'true';
  const desde = `from articulo a left join (select articulo_id, sum(cantidad) as total from movimiento_stock group by articulo_id) s on s.articulo_id = a.id
    where a.activo and a.controla_stock and ($1::text is null or a.nombre ilike $1 or a.codigo ilike $1)
      and (not $2::boolean or (a.stock_minimo is not null and coalesce(s.total, 0) < a.stock_minimo))`;
  const filas = await c.consultar(`select a.id as articulo_id, a.codigo, a.nombre, a.stock_minimo::text as stock_minimo, coalesce(s.total, 0)::text as total,
      (a.stock_minimo is not null and coalesce(s.total, 0) < a.stock_minimo) as bajo_minimo ${desde} order by a.nombre limit ${lim} offset ${des}`, [patron, bajo]);
  const total = (await c.uno(`select count(*)::int n ${desde}`, [patron, bajo])).n;
  const saldos = filas.length ? await c.consultar(`select articulo_id, deposito_id, saldo::text as saldo from v_stock_saldo where articulo_id = any($1::bigint[]) and saldo <> 0`, [filas.map((f) => f.articulo_id)]) : [];
  const reservas = filas.length ? await c.consultar('select articulo_id, reservado::text as reservado from v_stock_reservado where articulo_id = any($1::bigint[])', [filas.map((f) => f.articulo_id)]) : [];
  return { datos: filas.map((f) => { const reservado = reservas.find((r) => r.articulo_id === f.articulo_id)?.reservado ?? '0'; return { ...f, reservado: texto(dec(reservado), 4), disponible: texto(dec(f.total) - dec(reservado), 4), por_deposito: saldos.filter((s) => s.articulo_id === f.articulo_id).map((s) => ({ deposito_id: s.deposito_id, saldo: s.saldo })) }; }), total, limite: lim, desplazamiento: des };
}

const TIPOS = ['compra', 'venta', 'devolucion_venta', 'devolucion_compra', 'ajuste', 'inventario', 'transferencia_entrada', 'transferencia_salida'];
export async function listarMovimientos(c, { articulo_id, deposito_id, tipo, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  const entero = (v, k) => { if (v === undefined || v === '') return null; if (!/^\d{1,15}$/.test(String(v))) { errores[k] = 'tiene que ser un número'; return null; } return Number(v); };
  const art = entero(articulo_id, 'articulo_id'), dep = entero(deposito_id, 'deposito_id');
  if (tipo && !TIPOS.includes(tipo)) errores.tipo = `tiene que ser uno de: ${TIPOS.join(', ')}`;
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (Object.keys(errores).length) throw invalido(errores);
  const filtros = `($1::bigint is null or m.articulo_id = $1) and ($2::bigint is null or m.deposito_id = $2) and ($3::text is null or m.tipo = $3) and ($4::date is null or m.fecha >= $4) and ($5::date is null or m.fecha <= $5)`;
  const p = [art, dep, tipo || null, desde || null, hasta || null];
  const filas = await c.consultar(`select m.id, m.fecha::text as fecha, m.articulo_id, a.codigo, a.nombre as articulo, m.deposito_id, d.nombre as deposito, m.cantidad::text as cantidad, m.tipo, m.motivo,
      m.costo_unitario::text as costo_unitario, cb.id as comprobante_id, t.letra as comprobante_letra, cb.punto_venta as comprobante_pv, cb.numero as comprobante_numero
    from movimiento_stock m join articulo a on a.id = m.articulo_id join deposito d on d.id = m.deposito_id
    left join comprobante_item ci on ci.id = m.comprobante_item_id left join comprobante cb on cb.id = ci.comprobante_id left join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo
    where ${filtros} order by m.id desc limit ${lim} offset ${des}`, p);
  const total = (await c.uno(`select count(*)::int n from movimiento_stock m where ${filtros}`, p)).n;
  const formato = (f) => (f.comprobante_numero == null ? null : `${f.comprobante_letra ?? ''} ${String(f.comprobante_pv).padStart(4, '0')}-${String(f.comprobante_numero).padStart(8, '0')}`.trim());
  return { datos: filas.map(({ comprobante_letra, comprobante_pv, comprobante_numero, ...f }) => ({ ...f, comprobante: formato({ comprobante_letra, comprobante_pv, comprobante_numero }) })), total, limite: lim, desplazamiento: des };
}

/* ---------- ajustes y transferencias ---------- */
async function articuloYDeposito(c, articuloId, depositoId, campoDeposito = 'deposito_id', errores = {}) {
  const art = await c.uno('select id, codigo, nombre, controla_stock, activo from articulo where id = $1', [articuloId]);
  if (!art) errores.articulo_id = 'el artículo no existe'; else if (!art.activo) errores.articulo_id = 'el artículo está dado de baja'; else if (!art.controla_stock) errores.articulo_id = 'el artículo no controla stock (servicio, gasto o marcado sin control)';
  const dep = await c.uno('select id, nombre, activo from deposito where id = $1', [depositoId]);
  if (!dep) errores[campoDeposito] = 'el depósito no existe'; else if (!dep.activo) errores[campoDeposito] = 'el depósito está dado de baja';
  return { art, dep };
}
const saldoDe = async (c, articuloId, depositoId) => (await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, depositoId])).s;
async function exigirSaldoSuficiente(c, ctx, art, dep, saldo, sale) {
  const permite = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
  if (!permite && dec(saldo) < dec(sale)) throw new ErrorApi(422, 'stock_insuficiente', `Stock insuficiente de ${art.nombre} en ${dep.nombre}: hay ${cantidadTexto(saldo)} y se quieren sacar ${cantidadTexto(sale)}.`);
}
const mover = (c, ctx, { fecha, articuloId, depositoId, cantidad, tipo, motivo, costo }) => c.uno(
  'insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, motivo, costo_unitario) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, cantidad::text as cantidad',
  [ctx.empresaId, fecha, articuloId, depositoId, cantidad, tipo, motivo ?? null, costo ?? null]);

/* tipo: 'ingreso' (suma), 'egreso' (resta) o 'conteo' (inventario físico: la cantidad es lo CONTADO y se registra la diferencia contra el saldo). */
export async function ajustarStock(c, ctx, cuerpo) {
  const { valor: d } = validar({
    articulo_id: { tipo: 'entero', min: 1, requerido: true }, deposito_id: { tipo: 'entero', min: 1, requerido: true }, tipo: { tipo: 'enum', valores: ['ingreso', 'egreso', 'conteo'], requerido: true },
    cantidad: { tipo: 'importe', min: 0, max: 999999999999, requerido: true }, motivo: { tipo: 'texto', min: 3, max: 200, requerido: true }, fecha: { tipo: 'fecha' }, costo_unitario: { tipo: 'importe', min: 0, max: 999999999999 },
  }, cuerpo);
  const errores = {}, fecha = d.fecha ?? hoyISO();
  if (d.tipo !== 'conteo' && Number(d.cantidad) <= 0) errores.cantidad = 'tiene que ser mayor que cero';
  if (fecha > hoyISO()) errores.fecha = 'no puede ser futura';
  if (d.costo_unitario !== undefined && d.tipo !== 'ingreso') errores.costo_unitario = 'el costo solo se informa en los ingresos';
  const { art, dep } = await articuloYDeposito(c, d.articulo_id, d.deposito_id, 'deposito_id', errores);
  if (Object.keys(errores).length) throw invalido(errores);

  const antes = await saldoDe(c, art.id, dep.id);
  let delta, tipoMov;
  if (d.tipo === 'conteo') { delta = dec(d.cantidad) - dec(antes); tipoMov = 'inventario'; if (delta === 0n) throw new ErrorApi(422, 'sin_diferencia', `El conteo coincide con el saldo (${cantidadTexto(antes)}): no hay nada que ajustar.`); }
  else { delta = d.tipo === 'ingreso' ? dec(d.cantidad) : -dec(d.cantidad); tipoMov = 'ajuste'; }
  if (delta < 0n) await exigirSaldoSuficiente(c, ctx, art, dep, antes, texto(-delta, 4));
  const m = await mover(c, ctx, { fecha, articuloId: art.id, depositoId: dep.id, cantidad: texto(delta, 4), tipo: tipoMov, motivo: d.motivo, costo: d.costo_unitario });
  return { movimiento_id: m.id, articulo: { id: art.id, codigo: art.codigo, nombre: art.nombre }, deposito: dep.nombre, tipo: d.tipo, cantidad: m.cantidad, saldo_antes: antes, saldo_despues: await saldoDe(c, art.id, dep.id) };
}

export async function transferirStock(c, ctx, cuerpo) {
  const { valor: d } = validar({
    articulo_id: { tipo: 'entero', min: 1, requerido: true }, deposito_origen_id: { tipo: 'entero', min: 1, requerido: true }, deposito_destino_id: { tipo: 'entero', min: 1, requerido: true },
    cantidad: { tipo: 'importe', min: 0.0001, max: 999999999999, requerido: true }, motivo: { tipo: 'texto', min: 3, max: 200 }, fecha: { tipo: 'fecha' },
  }, cuerpo);
  const errores = {}, fecha = d.fecha ?? hoyISO();
  if (d.deposito_origen_id === d.deposito_destino_id) errores.deposito_destino_id = 'el destino tiene que ser otro depósito';
  if (fecha > hoyISO()) errores.fecha = 'no puede ser futura';
  const { art, dep: origen } = await articuloYDeposito(c, d.articulo_id, d.deposito_origen_id, 'deposito_origen_id', errores);
  const destino = await c.uno('select id, nombre, activo from deposito where id = $1', [d.deposito_destino_id]);
  if (!destino) errores.deposito_destino_id = 'el depósito no existe'; else if (!destino.activo) errores.deposito_destino_id = 'el depósito está dado de baja';
  if (Object.keys(errores).length) throw invalido(errores);
  const saldoOrigen = await saldoDe(c, art.id, origen.id);
  await exigirSaldoSuficiente(c, ctx, art, origen, saldoOrigen, d.cantidad);
  const motivo = d.motivo ?? `Transferencia de ${origen.nombre} a ${destino.nombre}`;
  const sale = await mover(c, ctx, { fecha, articuloId: art.id, depositoId: origen.id, cantidad: texto(-dec(d.cantidad), 4), tipo: 'transferencia_salida', motivo });
  const entra = await mover(c, ctx, { fecha, articuloId: art.id, depositoId: destino.id, cantidad: texto(dec(d.cantidad), 4), tipo: 'transferencia_entrada', motivo });
  return { movimientos: [sale.id, entra.id], articulo: { id: art.id, codigo: art.codigo, nombre: art.nombre }, origen: origen.nombre, destino: destino.nombre, cantidad: entra.cantidad,
    saldo_origen: await saldoDe(c, art.id, origen.id), saldo_destino: await saldoDe(c, art.id, destino.id) };
}
