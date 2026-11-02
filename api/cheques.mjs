// Cheques: la cartera de terceros (recibidos en un cobro) y los cheques propios (emitidos en un pago), con su historial. Los cheques NACEN dentro de un cobro
// o un pago (ver tesoreria.mjs) y la base los pasa de estado al confirmar o anular; acá se hacen los pasos que vienen después: depositar, acreditar o
// rechazar un cheque de un tercero, y debitar uno propio. Las reglas (fechas, estados, asiento, movimiento del banco) las impone fn_cheque_pasar en la base.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const ESTADOS = ['en_cartera', 'depositado', 'acreditado', 'rechazado', 'entregado', 'emitido', 'cobrado', 'anulado'];
/** Qué se puede hacer con un cheque según de quién es y en qué estado está. */
export const ACCIONES = {
  depositar: { origen: 'tercero', estado: 'en_cartera', texto: 'Depositó' },
  acreditar: { origen: 'tercero', estado: 'depositado', texto: 'Acreditó' },
  rechazar: { origen: 'tercero', estado: 'depositado', texto: 'Rechazó' },
  debitar: { origen: 'propio', estado: 'emitido', texto: 'Registró el débito de' },
  rebotar: { origen: 'tercero', estado: 'entregado', texto: 'Registró como rebotado' },                   // el proveedor al que se lo endosamos lo devolvió: su banco lo rechazó
  aceptar: { origen: 'tercero', estado: 'en_cartera', texto: 'Aceptó el ECHEQ', cuando: (ch) => ch.es_echeq && !ch.aceptado_en },       // un ECHEQ recibido se acepta antes de poder usarlo
};
const posibles = (ch) => Object.entries(ACCIONES).filter(([k, a]) => a.origen === ch.origen && a.estado === ch.estado && (!a.cuando || a.cuando(ch)) && !(['depositar'].includes(k) && ch.es_echeq && !ch.aceptado_en)).map(([k]) => k);

const SELECT = `select ch.id, ch.origen, ch.numero, ch.banco, ch.cuit_librador, ch.importe::text as importe, ch.fecha_emision::text as fecha_emision, ch.fecha_pago::text as fecha_pago, ch.estado,
    ch.es_echeq, ch.echeq_codigo, ch.caracter, ch.cruzado, ch.aceptado_en::text as aceptado_en, ch.rebotado_proveedor_id, rp.razon_social as rebotado_proveedor,
    (select pg.tercero_id from cheque_evento ev join pago pg on pg.id = ev.pago_id where ev.cheque_id = ch.id and ev.estado_nuevo = 'entregado' order by ev.id desc limit 1) as entregado_a_id,
    (select te2.razon_social from cheque_evento ev join pago pg on pg.id = ev.pago_id join tercero te2 on te2.id = pg.tercero_id where ev.cheque_id = ch.id and ev.estado_nuevo = 'entregado' order by ev.id desc limit 1) as entregado_a,
    ch.tercero_id, te.razon_social as tercero, ch.cuenta_bancaria_id, cb.banco as cuenta_banco, cb.numero_cuenta as cuenta_numero
  from cheque ch left join tercero te on te.id = ch.tercero_id left join tercero rp on rp.id = ch.rebotado_proveedor_id left join cuenta_bancaria cb on cb.id = ch.cuenta_bancaria_id`;
const completar = (f) => ({ ...f, acciones: posibles(f), diferido: !!f.fecha_pago && f.fecha_pago > hoyISO() });

export async function listarCheques(c, { estado, origen, tercero_id, q, echeq, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (estado && !ESTADOS.includes(estado)) errores.estado = `tiene que ser uno de: ${ESTADOS.join(', ')}`;
  if (origen && !['propio', 'tercero'].includes(origen)) errores.origen = 'tiene que ser propio o tercero';
  if (tercero_id && !/^\d{1,15}$/.test(String(tercero_id))) errores.tercero_id = 'tiene que ser un número';
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (echeq && !['true', 'false'].includes(String(echeq))) errores.echeq = 'tiene que ser true o false';
  if (Object.keys(errores).length) throw invalido(errores);
  const patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null;
  // el rango es sobre la fecha en que el cheque se puede cobrar (la de pago o, si no tiene, la de emisión)
  const donde = `($1::text is null or ch.estado = $1) and ($2::text is null or ch.origen = $2) and ($3::bigint is null or ch.tercero_id = $3) and ($4::text is null or ch.numero ilike $4 or ch.banco ilike $4 or te.razon_social ilike $4 or ch.echeq_codigo ilike $4)
    and ($7::boolean is null or ch.es_echeq = $7)
    and ($5::date is null or coalesce(ch.fecha_pago, ch.fecha_emision) >= $5) and ($6::date is null or coalesce(ch.fecha_pago, ch.fecha_emision) <= $6)`;
  const p = [estado || null, origen || null, tercero_id ? Number(tercero_id) : null, patron, desde || null, hasta || null, echeq === undefined || echeq === '' ? null : String(echeq) === 'true'];
  const filas = await c.consultar(`${SELECT} where ${donde} order by coalesce(ch.fecha_pago, ch.fecha_emision, ch.creado_en::date), ch.id limit ${lim} offset ${des}`, p);
  const total = (await c.uno(`select count(*)::int n from cheque ch left join tercero te on te.id = ch.tercero_id where ${donde}`, p)).n;
  const resumen = await c.consultar(`select origen, estado, cantidad::int as cantidad, importe::text as importe from v_cartera_cheques order by origen, estado`);
  return { datos: filas.map(completar), total, limite: lim, desplazamiento: des, resumen };
}

export async function detalleCheque(c, id) {
  const f = await c.uno(`${SELECT} where ch.id = $1`, [id]);
  if (!f) throw noEncontrado('El cheque');
  const eventos = await c.consultar(`select e.id, e.fecha::text as fecha, e.estado_anterior, e.estado_nuevo, e.nota, e.pago_id, p.sentido, p.punto_venta, p.numero
    from cheque_evento e left join pago p on p.id = e.pago_id where e.cheque_id = $1 order by e.id`, [id]);
  return { ...completar(f), eventos: eventos.map(({ sentido, punto_venta, numero, ...e }) => ({ ...e, comprobante: e.pago_id ? `${sentido === 'cobro' ? 'Recibo' : 'Orden de pago'} ${numeroFormateado(punto_venta, numero)}` : null })) };
}

const ESQUEMA = { fecha: { tipo: 'fecha' }, cuenta_bancaria_id: { tipo: 'entero', min: 1 }, motivo: { tipo: 'texto', min: 3, max: 200 } };
export async function pasarCheque(c, ctx, id, accion, cuerpo) {
  const def = ACCIONES[accion];
  if (!def) throw noEncontrado('La acción');
  const { valor: d } = validar(ESQUEMA, cuerpo ?? {}), errores = {};
  if (accion === 'depositar' && !d.cuenta_bancaria_id) errores.cuenta_bancaria_id = 'elegí la cuenta bancaria donde se deposita';
  if (accion === 'rechazar' && !d.motivo) errores.motivo = 'indicá el motivo del rechazo';
  if (accion === 'rebotar' && !d.motivo) errores.motivo = 'indicá el motivo del rebote';
  if (Object.keys(errores).length) throw invalido(errores);
  const antes = await c.uno('select id, numero, banco, importe::text importe, origen, estado, es_echeq, aceptado_en from cheque where id = $1 for update', [id]);
  if (!antes) throw noEncontrado('El cheque');
  if (accion === 'aceptar') {                                                         // no pasa por fn_cheque_pasar: no cambia de estado, solo queda aceptado
    if (!antes.es_echeq) throw new ErrorApi(422, 'no_es_echeq', 'Solo se acepta un ECHEQ.');
    if (antes.origen !== 'tercero' || antes.estado !== 'en_cartera') throw new ErrorApi(422, 'no_se_puede_aceptar', 'Solo se acepta un ECHEQ que está en la cartera.');
    if (antes.aceptado_en) throw new ErrorApi(422, 'ya_aceptado', 'El ECHEQ ya está aceptado.');
    const fecha = d.fecha ?? hoyISO();
    await c.consultar('update cheque set aceptado_en = $2 where id = $1', [id, fecha]);
    await c.consultar("insert into cheque_evento (empresa_id, cheque_id, fecha, estado_anterior, estado_nuevo, nota) values ($1,$2,$3,'en_cartera','en_cartera','Aceptó el ECHEQ')", [ctx.empresaId, id, fecha]);
    return { cheque: await detalleCheque(c, id), antes, texto: def.texto, motivo: null };
  }
  if (antes.es_echeq && !antes.aceptado_en && accion === 'depositar') throw new ErrorApi(422, 'echeq_sin_aceptar', `El ECHEQ ${antes.numero} todavía no fue aceptado: aceptalo antes de depositarlo.`);
  if (accion === 'rebotar') await c.consultar('select fn_cheque_rebotar($1, $2::date, $3)', [id, d.fecha ?? hoyISO(), d.motivo]);                  // la base repone la deuda del proveedor y del cliente, y asienta
  else await c.consultar('select fn_cheque_pasar($1, $2, $3::date, $4, $5)', [id, accion, d.fecha ?? hoyISO(), d.cuenta_bancaria_id ?? null, d.motivo ?? null]);   // la base valida estado, fechas y período, y genera el asiento y el movimiento
  const cheque = await detalleCheque(c, id);
  return { cheque, antes, texto: def.texto, motivo: d.motivo ?? null };
}
