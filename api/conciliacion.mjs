// Conciliación bancaria: se importa el extracto del banco (líneas con su importe: + entra, − sale), se lo CIERRA (la base verifica que el saldo final sea el inicial más las líneas, que las líneas caigan
// en el rango y que continúe el extracto anterior) y se concilia contra los movimientos de la cuenta bancaria en los libros. La conciliación es n a n y la base exige que ambos lados sumen igual.
// Lo que el banco hizo y los libros no registran (comisiones, intereses, impuestos) se registra desde la línea del extracto: queda como movimiento de la cuenta, con su asiento, y se concilia en el mismo paso.
// El sistema no se conecta a los bancos: el extracto se carga a mano o se pega desde el archivo que baja el home banking.
import { createHash } from 'node:crypto';
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { dec, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const IMPORTE = { tipo: 'importe', min: -999999999999, max: 999999999999 };

async function cuentaDe(c, id, errores = null) {
  const b = await c.uno('select id, banco, numero_cuenta, moneda, activa from cuenta_bancaria where id = $1', [id]);
  if (!b) { if (errores) { errores.cuenta_bancaria_id = 'la cuenta bancaria no existe'; return null; } throw noEncontrado('La cuenta bancaria'); }
  return b;
}

/* ====================== estado por cuenta ====================== */
export async function listarCuentas(c) {
  const filas = await c.consultar(`select cb.id, cb.banco, cb.numero_cuenta, cb.cuenta_contable_id is not null as con_cuenta_contable,
      coalesce((select sum(m.importe) from movimiento_tesoreria m where m.cuenta_bancaria_id = cb.id), 0)::text as saldo_libros,
      v.saldo_banco::text as saldo_banco, v.diferencia_total::text as diferencia_total, v.pendiente_banco::text as pendiente_banco, v.pendiente_libros::text as pendiente_libros,
      v.diferencia_apertura::text as diferencia_apertura, v.no_explicada::text as no_explicada,
      (select count(*)::int from movimiento_tesoreria m where m.cuenta_bancaria_id = cb.id and m.conciliacion_id is null) as movimientos_pendientes,
      (select count(*)::int from extracto_linea l join extracto_bancario e on e.id = l.extracto_id where e.cuenta_bancaria_id = cb.id and e.estado = 'cerrado' and l.conciliacion_id is null) as lineas_pendientes,
      (select count(*)::int from extracto_bancario e where e.cuenta_bancaria_id = cb.id and e.estado = 'borrador') as extractos_borrador,
      (select max(hasta)::text from extracto_bancario e where e.cuenta_bancaria_id = cb.id and e.estado = 'cerrado') as extracto_hasta
    from cuenta_bancaria cb left join v_conciliacion_estado v on v.cuenta_bancaria_id = cb.id where cb.activa order by cb.banco, cb.id`);
  return { datos: filas };
}

/* ====================== extractos ====================== */
const ESQUEMA_EXTRACTO = {
  cuenta_bancaria_id: { tipo: 'entero', min: 1, requerido: true }, desde: { tipo: 'fecha', requerido: true }, hasta: { tipo: 'fecha', requerido: true },
  saldo_inicial: { ...IMPORTE, requerido: true }, saldo_final: { ...IMPORTE, requerido: true }, nombre_archivo: { tipo: 'texto', max: 120, nulo: true },
  lineas: { tipo: 'lista', min: 1, max: 5000, requerido: true, elemento: { fecha: { tipo: 'fecha', requerido: true }, descripcion: { tipo: 'texto', max: 200, nulo: true }, referencia: { tipo: 'texto', max: 60, nulo: true }, importe: { ...IMPORTE, requerido: true } } },
};

export async function importarExtracto(c, ctx, cuerpo) {
  const { valor: d } = validar(ESQUEMA_EXTRACTO, cuerpo), errores = {}, avisos = [];
  const b = await cuentaDe(c, d.cuenta_bancaria_id, errores);
  if (b && !b.activa) errores.cuenta_bancaria_id = 'la cuenta bancaria está dada de baja';
  if (b && b.moneda !== 'PES') errores.cuenta_bancaria_id = 'por ahora solo se concilian cuentas en pesos';
  if (d.hasta < d.desde) errores.hasta = 'no puede ser anterior a "desde"';
  if (d.hasta > hoyISO()) errores.hasta = 'el extracto no puede terminar en el futuro';
  d.lineas.forEach((l, i) => {
    if (dec(l.importe) === 0n) errores[`lineas[${i}].importe`] = 'no puede ser cero';
    if (l.fecha < d.desde || l.fecha > d.hasta) errores[`lineas[${i}].fecha`] = `tiene que estar entre ${d.desde} y ${d.hasta}`;
  });
  if (Object.keys(errores).length) throw invalido(errores);
  const suma = d.lineas.reduce((s, l) => s + dec(l.importe), 0n), esperado = dec(d.saldo_final) - dec(d.saldo_inicial);
  if (suma !== esperado) avisos.push(`El saldo final no es el inicial más las líneas (diferencia de $ ${texto(esperado - suma)}): corregilo antes de cerrar el extracto.`);
  const huella = createHash('sha256').update(JSON.stringify([d.cuenta_bancaria_id, d.desde, d.hasta, d.saldo_inicial, d.saldo_final, d.lineas.map((l) => [l.fecha, l.descripcion ?? '', l.referencia ?? '', l.importe])])).digest('hex');
  if (await c.uno('select 1 x from extracto_bancario where empresa_id = $1 and cuenta_bancaria_id = $2 and hash_archivo = $3', [ctx.empresaId, d.cuenta_bancaria_id, huella])) throw new ErrorApi(409, 'extracto_repetido', 'Ya importaste ese mismo extracto.');
  const e = await c.uno(`insert into extracto_bancario (empresa_id, cuenta_bancaria_id, desde, hasta, saldo_inicial, saldo_final, origen, nombre_archivo, hash_archivo) values ($1,$2,$3,$4,$5,$6,'archivo',$7,$8) returning id`,
    [ctx.empresaId, d.cuenta_bancaria_id, d.desde, d.hasta, d.saldo_inicial, d.saldo_final, d.nombre_archivo ?? null, huella]);
  const ordenadas = d.lineas.map((l, i) => ({ ...l, i })).sort((a, z) => (a.fecha < z.fecha ? -1 : a.fecha > z.fecha ? 1 : a.i - z.i));
  for (const [n, l] of ordenadas.entries()) await c.consultar('insert into extracto_linea (empresa_id, extracto_id, orden, fecha, descripcion, referencia, importe) values ($1,$2,$3,$4,$5,$6,$7)', [ctx.empresaId, e.id, n + 1, l.fecha, l.descripcion ?? null, l.referencia ?? null, l.importe]);
  return { extracto: await detalleExtracto(c, e.id), avisos, banco: b };
}

const SELECT_EXTRACTO = `select e.id, e.cuenta_bancaria_id, cb.banco, cb.numero_cuenta, e.desde::text as desde, e.hasta::text as hasta, e.saldo_inicial::text as saldo_inicial, e.saldo_final::text as saldo_final, e.estado, e.nombre_archivo, e.importado_en,
    (select count(*)::int from extracto_linea l where l.extracto_id = e.id) as lineas, (select count(*)::int from extracto_linea l where l.extracto_id = e.id and l.conciliacion_id is not null) as conciliadas,
    (select coalesce(sum(l.importe), 0)::text from extracto_linea l where l.extracto_id = e.id) as suma_lineas
  from extracto_bancario e join cuenta_bancaria cb on cb.id = e.cuenta_bancaria_id`;
const darExtracto = (f) => ({ ...f, cierra: dec(f.saldo_final) === dec(f.saldo_inicial) + dec(f.suma_lineas), acciones: { cerrar: f.estado === 'borrador', borrar: f.estado === 'borrador' } });

export async function listarExtractos(c, { cuenta_bancaria_id } = {}) {
  if (cuenta_bancaria_id && !/^\d{1,15}$/.test(String(cuenta_bancaria_id))) throw invalido({ cuenta_bancaria_id: 'tiene que ser un número' });
  const filas = await c.consultar(`${SELECT_EXTRACTO} where ($1::bigint is null or e.cuenta_bancaria_id = $1) order by e.desde desc, e.id desc limit 100`, [cuenta_bancaria_id ? Number(cuenta_bancaria_id) : null]);
  return { datos: filas.map(darExtracto) };
}

export async function detalleExtracto(c, id) {
  const f = await c.uno(`${SELECT_EXTRACTO} where e.id = $1`, [id]);
  if (!f) throw noEncontrado('El extracto');
  const lineas = await c.consultar('select id, orden, fecha::text as fecha, descripcion, referencia, importe::text as importe, conciliacion_id from extracto_linea where extracto_id = $1 order by orden', [id]);
  return { ...darExtracto(f), detalle: lineas };
}

export async function cerrarExtracto(c, ctx, id) {
  const f = await c.uno('select id, estado from extracto_bancario where id = $1 for update', [id]);
  if (!f) throw noEncontrado('El extracto');
  if (f.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_cerrar', 'El extracto ya está cerrado.');
  await c.consultar(`update extracto_bancario set estado = 'cerrado' where id = $1`, [id]);          // la base verifica saldo, rango y continuidad con el extracto anterior
  return detalleExtracto(c, id);
}

export async function borrarExtracto(c, ctx, id) {
  const f = await c.uno('select id, estado from extracto_bancario where id = $1 for update', [id]);
  if (!f) throw noEncontrado('El extracto');
  if (f.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_borrar', 'Un extracto cerrado no se borra.');
  const e = await detalleExtracto(c, id);
  await c.consultar('delete from extracto_bancario where id = $1', [id]);
  return e;
}

/* ====================== lo que falta conciliar ====================== */
export async function pendientes(c, cuentaId, { dias } = {}) {
  const b = await cuentaDe(c, cuentaId);
  const d = dias === undefined ? 3 : Number(dias);
  if (!Number.isInteger(d) || d < 0 || d > 30) throw invalido({ dias: 'tiene que ser un número de 0 a 30' });
  const lineas = await c.consultar(`select l.id, l.fecha::text as fecha, l.descripcion, l.referencia, l.importe::text as importe, e.id as extracto_id from extracto_linea l join extracto_bancario e on e.id = l.extracto_id
    where e.cuenta_bancaria_id = $1 and e.estado = 'cerrado' and l.conciliacion_id is null order by l.fecha, l.id`, [cuentaId]);
  const movimientos = await c.consultar(`select m.id, m.fecha::text as fecha, m.concepto, m.importe::text as importe, m.pago_medio_id,
      p.sentido, p.punto_venta, p.numero, te.razon_social as tercero
    from movimiento_tesoreria m left join pago_medio pm on pm.id = m.pago_medio_id left join pago p on p.id = pm.pago_id left join tercero te on te.id = p.tercero_id
    where m.cuenta_bancaria_id = $1 and m.conciliacion_id is null order by m.fecha, m.id`, [cuentaId]);
  const sugerencias = await c.consultar('select linea_id, movimiento_id, dif_dias from fn_sugerir_conciliacion($1, $2)', [cuentaId, d]);
  return { banco: b, lineas, movimientos: movimientos.map(({ sentido, punto_venta, numero, ...m }) => ({ ...m, comprobante: sentido ? `${sentido === 'cobro' ? 'Recibo' : 'Orden de pago'} ${String(punto_venta).padStart(4, '0')}-${String(numero).padStart(8, '0')}` : null })), sugerencias };
}

/* ====================== conciliar ====================== */
const ESQUEMA_CONCILIAR = {
  cuenta_bancaria_id: { tipo: 'entero', min: 1, requerido: true }, fecha: { tipo: 'fecha' },
  lineas: { tipo: 'lista', min: 1, max: 500, requerido: true, elemento: { id: { tipo: 'entero', min: 1, requerido: true } } },
  movimientos: { tipo: 'lista', min: 1, max: 500, requerido: true, elemento: { id: { tipo: 'entero', min: 1, requerido: true } } },
};
const detalleConciliacion = async (c, id) => {
  const f = await c.uno('select cn.id, cn.cuenta_bancaria_id, cn.fecha::text as fecha, cn.importe::text as importe, cn.estado, (select count(*)::int from extracto_linea l where l.conciliacion_id = cn.id) as lineas, (select count(*)::int from movimiento_tesoreria m where m.conciliacion_id = cn.id) as movimientos from conciliacion cn where cn.id = $1', [id]);
  if (!f) throw noEncontrado('La conciliación');
  return f;
};

export async function conciliar(c, ctx, cuerpo) {
  const { valor: d } = validar(ESQUEMA_CONCILIAR, cuerpo);
  await cuentaDe(c, d.cuenta_bancaria_id);
  const id = (await c.uno('select fn_conciliar($1, $2::bigint[], $3::bigint[], $4::date) as id', [d.cuenta_bancaria_id, d.lineas.map((x) => x.id), d.movimientos.map((x) => x.id), d.fecha ?? hoyISO()])).id;   // la base exige que ambos lados sumen igual
  return detalleConciliacion(c, id);
}

/* Concilia todas las coincidencias 1 a 1 seguras (mismo importe, fecha cercana y un único candidato de cada lado). */
export async function aceptarSugerencias(c, ctx, cuerpo) {
  const { valor: d } = validar({ cuenta_bancaria_id: { tipo: 'entero', min: 1, requerido: true }, dias: { tipo: 'entero', min: 0, max: 30 } }, cuerpo);
  await cuentaDe(c, d.cuenta_bancaria_id);
  const sug = await c.consultar('select linea_id, movimiento_id from fn_sugerir_conciliacion($1, $2)', [d.cuenta_bancaria_id, d.dias ?? 3]);
  const ids = [];
  for (const s of sug) ids.push((await c.uno('select fn_conciliar($1, $2::bigint[], $3::bigint[], current_date) as id', [d.cuenta_bancaria_id, [s.linea_id], [s.movimiento_id]])).id);
  return { conciliaciones: ids.length, ids };
}

export async function deshacerConciliacion(c, ctx, id) {
  const antes = await detalleConciliacion(c, id);
  await c.consultar('select fn_deshacer_conciliacion($1)', [id]);
  return { antes, conciliacion: await detalleConciliacion(c, id) };
}

export async function historial(c, cuentaId) {
  await cuentaDe(c, cuentaId);
  const filas = await c.consultar(`select cn.id, cn.fecha::text as fecha, cn.importe::text as importe, cn.estado, (select count(*)::int from extracto_linea l where l.conciliacion_id = cn.id) as lineas, (select count(*)::int from movimiento_tesoreria m where m.conciliacion_id = cn.id) as movimientos
    from conciliacion cn where cn.cuenta_bancaria_id = $1 and cn.estado = 'vigente' order by cn.id desc limit 50`, [cuentaId]);
  return { datos: filas };
}

/* ====================== lo que solo está en el banco ====================== */
const ESQUEMA_MOVIMIENTO = {
  linea_id: { tipo: 'entero', min: 1 }, cuenta_bancaria_id: { tipo: 'entero', min: 1 }, fecha: { tipo: 'fecha' }, importe: { ...IMPORTE }, concepto: { tipo: 'texto', min: 3, max: 200 },
  cuenta_contable_id: { tipo: 'entero', min: 1, requerido: true },
};

/* Con `linea_id` el movimiento sale de una línea del extracto (cuenta, fecha e importe son los de la línea) y se concilia en el mismo paso; sin ella se registra un movimiento suelto del banco. */
export async function registrarMovimiento(c, ctx, cuerpo) {
  const { valor: d } = validar(ESQUEMA_MOVIMIENTO, cuerpo), errores = {};
  let cuentaId = d.cuenta_bancaria_id, fecha = d.fecha ?? hoyISO(), importe = d.importe, concepto = d.concepto, linea = null;
  if (d.linea_id) {
    linea = await c.uno(`select l.id, l.fecha::text as fecha, l.descripcion, l.importe::text as importe, l.conciliacion_id, e.cuenta_bancaria_id, e.estado from extracto_linea l join extracto_bancario e on e.id = l.extracto_id where l.id = $1 for update of l`, [d.linea_id]);
    if (!linea) throw noEncontrado('La línea del extracto');
    if (linea.estado !== 'cerrado') errores.linea_id = 'el extracto tiene que estar cerrado';
    else if (linea.conciliacion_id) errores.linea_id = 'la línea ya está conciliada';
    cuentaId = linea.cuenta_bancaria_id; fecha = linea.fecha; importe = linea.importe; concepto = d.concepto ?? linea.descripcion ?? '';
    if (d.importe !== undefined || d.fecha !== undefined || (d.cuenta_bancaria_id !== undefined && d.cuenta_bancaria_id !== cuentaId)) errores.linea_id = 'con una línea del extracto no se indican cuenta, fecha ni importe: son los de la línea';
  } else {
    if (!cuentaId) errores.cuenta_bancaria_id = 'es obligatoria (o indicá la línea del extracto)';
    if (importe === undefined) errores.importe = 'es obligatorio (negativo si sale de la cuenta)';
    if (!concepto) errores.concepto = 'es obligatorio';
  }
  if (Object.keys(errores).length) throw invalido(errores);
  await cuentaDe(c, cuentaId);
  const mov = (await c.uno('select fn_movimiento_bancario($1, $2::date, $3::numeric, $4, $5) as id', [cuentaId, fecha, importe, concepto, d.cuenta_contable_id])).id;   // la base valida período, cuenta y asiento
  let conciliacion = null;
  if (linea) conciliacion = await detalleConciliacion(c, (await c.uno('select fn_conciliar($1, $2::bigint[], $3::bigint[], $4::date) as id', [cuentaId, [linea.id], [mov], hoyISO()])).id);
  const m = await c.uno(`select m.id, m.fecha::text as fecha, m.importe::text as importe, m.concepto, m.asiento_id, m.conciliacion_id from movimiento_tesoreria m where m.id = $1`, [mov]);
  return { movimiento: m, conciliacion };
}
