// Tesorería: cajas y cuentas bancarias, cobros (recibos a clientes) y pagos (órdenes de pago a proveedores), con imputación a las facturas,
// retenciones con su certificado, descuentos y saldo "a cuenta". Un cobro y un pago son el mismo objeto del modelo (tabla `pago`) con sentido distinto.
// La base impone lo de fondo: identidad contable (medios + retenciones + descuentos = imputado + a cuenta), no imputar más que el saldo, asiento automático,
// y que la caja y el banco se muevan SOLO al confirmar o anular. Acá se agrega lo que conviene avisar antes (y que no se gire más de lo que hay).
import { createHash } from 'node:crypto';
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const ROL = {
  cobro: { sentido: 'venta', retencion: 'sufrida', recibo: 'Recibo', tercero: 'cliente', condicion: 'es_cliente' },
  pago: { sentido: 'compra', retencion: 'practicada', recibo: 'Orden de pago', tercero: 'proveedor', condicion: 'es_proveedor' },
};
const entre = (x, a, b) => x >= a && x <= b;

/* ====================== cajas y cuentas bancarias ====================== */
const cuentaPorDefecto = async (c, codigo) => (await c.uno('select id from plan_cuenta where codigo = $1 and imputable and activa', [codigo]))?.id ?? null;
async function validarCuenta(c, id, errores) { if (id != null && !(await c.uno('select 1 x from plan_cuenta where id = $1 and imputable and activa', [id]))) errores.cuenta_contable_id = 'la cuenta no existe o no es imputable'; }

const SELECT_CAJA = `select ca.id, ca.nombre, ca.tipo, ca.activa, ca.cuenta_contable_id, pc.codigo as cuenta_codigo, pc.nombre as cuenta_nombre, coalesce(s.saldo, 0)::text as saldo
  from caja ca left join plan_cuenta pc on pc.id = ca.cuenta_contable_id left join (select caja_id, sum(importe) as saldo from movimiento_tesoreria where caja_id is not null group by caja_id) s on s.caja_id = ca.id`;
export async function listarCajas(c) { return { datos: await c.consultar(`${SELECT_CAJA} order by ca.nombre`) }; }
const leerCaja = async (c, id) => { const f = await c.uno(`${SELECT_CAJA} where ca.id = $1`, [id]); if (!f) throw noEncontrado('La caja'); return f; };
export async function crearCaja(c, ctx, cuerpo) {
  const { valor: d } = validar({ nombre: { tipo: 'texto', min: 2, max: 60, requerido: true }, tipo: { tipo: 'enum', valores: ['efectivo', 'tarjetas', 'otra'] }, cuenta_contable_id: { tipo: 'entero', min: 1 } }, cuerpo);
  const errores = {}; await validarCuenta(c, d.cuenta_contable_id, errores); if (Object.keys(errores).length) throw invalido(errores);
  if (await c.uno('select 1 x from caja where lower(nombre) = lower($1)', [d.nombre])) throw new ErrorApi(409, 'duplicado', 'Ya existe una caja con ese nombre.');
  const r = await c.uno('insert into caja (empresa_id, nombre, tipo, cuenta_contable_id) values ($1,$2,$3,$4) returning id', [ctx.empresaId, d.nombre, d.tipo ?? 'efectivo', d.cuenta_contable_id ?? await cuentaPorDefecto(c, '1.1.1')]);
  return leerCaja(c, r.id);
}
export async function modificarCaja(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ nombre: { tipo: 'texto', min: 2, max: 60 }, activa: { tipo: 'booleano' }, cuenta_contable_id: { tipo: 'entero', min: 1 } }, cuerpo, { parcial: true });
  if (!Object.keys(d).length) throw invalido({ _: 'No hay nada para modificar.' });
  const antes = await leerCaja(c, id), errores = {};
  await validarCuenta(c, d.cuenta_contable_id, errores);
  if (d.activa === false && dec(antes.saldo) !== 0n) errores.activa = `la caja tiene $ ${antes.saldo}: pasá ese dinero a otra caja antes de darla de baja`;
  if (Object.keys(errores).length) throw invalido(errores);
  if (d.nombre !== undefined && await c.uno('select 1 x from caja where lower(nombre) = lower($1) and id <> $2', [d.nombre, id])) throw new ErrorApi(409, 'duplicado', 'Ya existe una caja con ese nombre.');
  const cambios = ['nombre', 'activa', 'cuenta_contable_id'].filter((k) => k in d && d[k] !== antes[k]).map((k) => [k, String(antes[k]), String(d[k])]);
  if (cambios.length) await c.consultar('update caja set nombre = coalesce($2, nombre), activa = coalesce($3, activa), cuenta_contable_id = coalesce($4, cuenta_contable_id) where id = $1', [id, d.nombre ?? null, d.activa ?? null, d.cuenta_contable_id ?? null]);
  return { caja: await leerCaja(c, id), cambios };
}

const SELECT_BANCO = `select cb.id, cb.banco, cb.numero_cuenta, cb.cbu, cb.alias, cb.activa, cb.cuenta_contable_id, pc.codigo as cuenta_codigo, coalesce(s.saldo, 0)::text as saldo
  from cuenta_bancaria cb left join plan_cuenta pc on pc.id = cb.cuenta_contable_id left join (select cuenta_bancaria_id, sum(importe) as saldo from movimiento_tesoreria where cuenta_bancaria_id is not null group by cuenta_bancaria_id) s on s.cuenta_bancaria_id = cb.id`;
export async function listarBancos(c) { return { datos: await c.consultar(`${SELECT_BANCO} order by cb.banco, cb.numero_cuenta`) }; }
const leerBanco = async (c, id) => { const f = await c.uno(`${SELECT_BANCO} where cb.id = $1`, [id]); if (!f) throw noEncontrado('La cuenta bancaria'); return f; };
const CAMPOS_BANCO = { banco: { tipo: 'texto', min: 2, max: 60 }, numero_cuenta: { tipo: 'texto', max: 40, nulo: true }, cbu: { tipo: 'texto', max: 22, patron: /^\d{22}$/, mensajePatron: 'el CBU tiene 22 dígitos', nulo: true }, alias: { tipo: 'texto', max: 40, nulo: true }, cuenta_contable_id: { tipo: 'entero', min: 1 } };
export async function crearBanco(c, ctx, cuerpo) {
  const { valor: d } = validar({ ...CAMPOS_BANCO, banco: { ...CAMPOS_BANCO.banco, requerido: true } }, cuerpo);
  const errores = {}; await validarCuenta(c, d.cuenta_contable_id, errores); if (Object.keys(errores).length) throw invalido(errores);
  if (d.cbu && await c.uno('select 1 x from cuenta_bancaria where cbu = $1', [d.cbu])) throw new ErrorApi(409, 'duplicado', 'Ya hay una cuenta con ese CBU.');
  const r = await c.uno('insert into cuenta_bancaria (empresa_id, banco, numero_cuenta, cbu, alias, cuenta_contable_id) values ($1,$2,$3,$4,$5,$6) returning id', [ctx.empresaId, d.banco, d.numero_cuenta ?? null, d.cbu ?? null, d.alias ?? null, d.cuenta_contable_id ?? await cuentaPorDefecto(c, '1.1.4')]);
  return leerBanco(c, r.id);
}
export async function modificarBanco(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ ...CAMPOS_BANCO, activa: { tipo: 'booleano' } }, cuerpo, { parcial: true });
  if (!Object.keys(d).length) throw invalido({ _: 'No hay nada para modificar.' });
  const antes = await leerBanco(c, id), errores = {};
  await validarCuenta(c, d.cuenta_contable_id, errores);
  if (d.activa === false && dec(antes.saldo) !== 0n) errores.activa = `la cuenta tiene $ ${antes.saldo}: transferí ese dinero antes de darla de baja`;
  if (Object.keys(errores).length) throw invalido(errores);
  const claves = ['banco', 'numero_cuenta', 'cbu', 'alias', 'activa', 'cuenta_contable_id'].filter((k) => k in d), cambios = claves.filter((k) => (d[k] ?? null) !== (antes[k] ?? null)).map((k) => [k, String(antes[k] ?? '—'), String(d[k] ?? '—')]);
  if (cambios.length) { const ks = cambios.map((x) => x[0]); await c.consultar(`update cuenta_bancaria set ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...ks.map((k) => d[k] ?? null)]); }
  return { banco: await leerBanco(c, id), cambios };
}

export async function listarMovimientosTesoreria(c, { caja_id, cuenta_bancaria_id, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  const ent = (v, k) => { if (v === undefined || v === '') return null; if (!/^\d{1,15}$/.test(String(v))) { errores[k] = 'tiene que ser un número'; return null; } return Number(v); };
  const caja = ent(caja_id, 'caja_id'), banco = ent(cuenta_bancaria_id, 'cuenta_bancaria_id');
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (Object.keys(errores).length) throw invalido(errores);
  const filtros = '($1::bigint is null or m.caja_id = $1) and ($2::bigint is null or m.cuenta_bancaria_id = $2) and ($3::date is null or m.fecha >= $3) and ($4::date is null or m.fecha <= $4)', p = [caja, banco, desde || null, hasta || null];
  const filas = await c.consultar(`select m.id, m.fecha::text as fecha, m.importe::text as importe, m.concepto, ca.nombre as caja, cb.banco as banco, m.caja_id, m.cuenta_bancaria_id, pm.pago_id
    from movimiento_tesoreria m left join caja ca on ca.id = m.caja_id left join cuenta_bancaria cb on cb.id = m.cuenta_bancaria_id left join pago_medio pm on pm.id = m.pago_medio_id
    where ${filtros} order by m.fecha desc, m.id desc limit ${lim} offset ${des}`, p);
  return { datos: filas, total: (await c.uno(`select count(*)::int n from movimiento_tesoreria m where ${filtros}`, p)).n, limite: lim, desplazamiento: des };
}

/* ====================== cobros y pagos ====================== */
const ESQUEMA = {
  tercero_id: { tipo: 'entero', min: 1, requerido: true }, fecha: { tipo: 'fecha' }, observaciones: { tipo: 'texto', max: 500 }, descuento: { tipo: 'importe', min: 0, max: 999999999999 },
  imputaciones: { tipo: 'lista', max: 100, elemento: { comprobante_id: { tipo: 'entero', min: 1, requerido: true }, importe: { tipo: 'importe', min: 0.01, max: 999999999999, requerido: true } } },
  medios: { tipo: 'lista', max: 20, elemento: { medio: { tipo: 'enum', valores: ['efectivo', 'tarjeta', 'transferencia'], requerido: true }, caja_id: { tipo: 'entero', min: 1 }, cuenta_bancaria_id: { tipo: 'entero', min: 1 }, importe: { tipo: 'importe', min: 0.01, max: 999999999999, requerido: true } } },
  retenciones: { tipo: 'lista', max: 20, elemento: {
    tipo: { tipo: 'enum', valores: ['iva', 'ganancias', 'iibb', 'suss'], requerido: true }, jurisdiccion_codigo: { tipo: 'entero', min: 1, max: 32767 }, base_imponible: { tipo: 'importe', min: 0, max: 999999999999 },
    alicuota: { tipo: 'porcentaje' }, importe: { tipo: 'importe', min: 0.01, max: 999999999999, requerido: true }, certificado_numero: { tipo: 'texto', min: 1, max: 30, requerido: true }, certificado_fecha: { tipo: 'fecha', requerido: true },
  } },
};

async function prepararPago(c, ctx, tipoPago, cuerpo) {
  const rol = ROL[tipoPago], { valor: d } = validar(ESQUEMA, cuerpo), errores = {}, avisos = [], hoy = hoyISO(), fecha = d.fecha ?? hoy;
  const tercero = await c.uno(`select id, razon_social, activo, ${rol.condicion} as ok from tercero where id = $1`, [d.tercero_id]);
  if (!tercero || !tercero.ok) throw invalido({ tercero_id: `el ${rol.tercero} no existe` });
  if (!tercero.activo) errores.tercero_id = `el ${rol.tercero} está dado de baja`;
  if (fecha > hoy) errores.fecha = 'la fecha no puede ser futura';
  else if (fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha es de hace más de 3 años';
  else { const per = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, fecha])).p; if (per !== 'ok') errores.fecha = { sin_periodo: 'no hay un período contable abierto para esa fecha', cerrado: 'el período de esa fecha está cerrado', vencido: 'el período de esa fecha ya venció' }[per]; }

  // --- a qué comprobantes se imputa
  const imput = [], idsImp = new Set();
  const comps = (d.imputaciones?.length ? await c.consultar(`select c.id, c.sentido, c.estado, c.tercero_id, t.signo, t.descripcion as tipo, c.punto_venta, c.numero, coalesce(v.saldo, 0)::text as saldo
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo left join v_saldo_comprobante v on v.comprobante_id = c.id where c.id = any($1::bigint[])`, [d.imputaciones.map((x) => x.comprobante_id)]) : []);
  for (const [i, it] of (d.imputaciones ?? []).entries()) {
    const k = `imputaciones[${i}].`, f = comps.find((x) => x.id === it.comprobante_id);
    if (!f || f.sentido !== rol.sentido) { errores[k + 'comprobante_id'] = 'el comprobante no existe'; continue; }
    if (idsImp.has(f.id)) { errores[k + 'comprobante_id'] = 'ese comprobante está repetido'; continue; }
    idsImp.add(f.id);
    const nombre = `${f.tipo} ${f.numero == null ? '' : numeroFormateado(f.punto_venta, f.numero)}`.trim();
    if (f.tercero_id !== tercero.id) errores[k + 'comprobante_id'] = `${nombre} es de otro ${rol.tercero}`;
    else if (!['confirmado', 'autorizado'].includes(f.estado) || Number(f.signo) !== 1) errores[k + 'comprobante_id'] = `${nombre} no es una deuda que se pueda cancelar (está ${f.estado}${Number(f.signo) !== 1 ? ' o es una nota de crédito' : ''})`;
    else if (dec(it.importe) > dec(f.saldo)) errores[k + 'importe'] = `${nombre} tiene un saldo de $ ${f.saldo}: no se le puede imputar $ ${it.importe}`;
    imput.push({ id: f.id, nombre, importe: it.importe, saldoAntes: f.saldo, saldoDespues: texto(dec(f.saldo) - dec(it.importe)) });
  }

  // --- con qué se cobra o se paga
  const cajas = await c.consultar('select id, nombre, tipo, activa, moneda from caja'), bancos = await c.consultar('select id, banco, numero_cuenta, activa, moneda from cuenta_bancaria');
  const medios = [], salidas = new Map();
  for (const [i, m] of (d.medios ?? []).entries()) {
    const k = `medios[${i}].`;
    if (m.medio === 'transferencia') {
      if (m.caja_id) errores[k + 'caja_id'] = 'una transferencia no va a una caja';
      const b = bancos.find((x) => x.id === m.cuenta_bancaria_id);
      if (!m.cuenta_bancaria_id) errores[k + 'cuenta_bancaria_id'] = 'elegí la cuenta bancaria'; else if (!b) errores[k + 'cuenta_bancaria_id'] = 'la cuenta bancaria no existe'; else if (!b.activa) errores[k + 'cuenta_bancaria_id'] = 'la cuenta bancaria está dada de baja'; else if (b.moneda !== 'PES') errores[k + 'cuenta_bancaria_id'] = 'por ahora solo se trabaja en pesos';
      medios.push({ ...m, destino: b ? `${b.banco}${b.numero_cuenta ? ` ${b.numero_cuenta}` : ''}` : '', clave: `b${m.cuenta_bancaria_id}`, saldoSql: ['cuenta_bancaria_id', m.cuenta_bancaria_id] });
    } else {
      if (m.cuenta_bancaria_id) errores[k + 'cuenta_bancaria_id'] = `${m.medio === 'tarjeta' ? 'una tarjeta' : 'el efectivo'} no va a una cuenta bancaria`;
      const ca = cajas.find((x) => x.id === m.caja_id), tipoOk = m.medio === 'tarjeta' ? ['tarjetas'] : ['efectivo', 'otra'];
      if (!m.caja_id) errores[k + 'caja_id'] = 'elegí la caja'; else if (!ca) errores[k + 'caja_id'] = 'la caja no existe'; else if (!ca.activa) errores[k + 'caja_id'] = 'la caja está dada de baja'; else if (!tipoOk.includes(ca.tipo)) errores[k + 'caja_id'] = m.medio === 'tarjeta' ? 'para tarjetas hace falta una caja de tipo tarjetas' : 'esa caja no es de efectivo'; else if (ca.moneda !== 'PES') errores[k + 'caja_id'] = 'por ahora solo se trabaja en pesos';
      medios.push({ ...m, destino: ca?.nombre ?? '', clave: `c${m.caja_id}`, saldoSql: ['caja_id', m.caja_id] });
    }
  }

  // --- retenciones (sufridas al cobrar, practicadas al pagar), cada una con su certificado
  const rets = [];
  for (const [i, r] of (d.retenciones ?? []).entries()) {
    const k = `retenciones[${i}].`;
    if (r.tipo === 'iibb' && !r.jurisdiccion_codigo) errores[k + 'jurisdiccion_codigo'] = 'una retención de ingresos brutos necesita su jurisdicción';
    else if (r.jurisdiccion_codigo && !(await c.uno('select 1 x from arca_jurisdiccion where codigo = $1', [r.jurisdiccion_codigo]))) errores[k + 'jurisdiccion_codigo'] = 'la jurisdicción no existe';
    if (r.certificado_fecha > hoy) errores[k + 'certificado_fecha'] = 'la fecha del certificado no puede ser futura';
    if (rol.retencion === 'practicada' && await c.uno(`select 1 x from retencion where origen = 'practicada' and tipo = $1 and certificado_numero = $2`, [r.tipo, r.certificado_numero])) errores[k + 'certificado_numero'] = 'ya hay un certificado propio con ese número';
    rets.push(r);
  }

  // --- identidad contable: medios + retenciones + descuentos = imputado + a cuenta
  const suma = (xs, f) => xs.reduce((s, x) => s + dec(f(x)), 0n);
  const tm = suma(medios, (m) => m.importe), tr = suma(rets, (r) => r.importe), td = dec(d.descuento ?? '0'), ti = suma(imput, (x) => x.importe), doc = tm + tr + td;
  if (doc <= 0n) errores.medios = tipoPago === 'cobro' ? 'cargá al menos un medio de cobro o una retención' : 'cargá al menos un medio de pago o una retención';
  else if (ti > doc) errores.imputaciones = `lo imputado ($ ${texto(ti)}) supera lo ${tipoPago === 'cobro' ? 'cobrado' : 'pagado'} ($ ${texto(doc)})`;
  if (td > 0n && ti > 0n && td > ti) errores.descuento = 'el descuento no puede ser mayor que lo imputado';
  if (Object.keys(errores).length) throw invalido(errores);

  // --- no se gira más de lo que hay (en un pago, o al devolver un cobro)
  if (tipoPago === 'pago') {
    const porDestino = new Map(); for (const m of medios) porDestino.set(m.clave, { m, total: (porDestino.get(m.clave)?.total ?? 0n) + dec(m.importe) });
    for (const { m, total } of porDestino.values()) {
      const saldo = (await c.uno(`select coalesce(sum(importe), 0)::text s from movimiento_tesoreria where ${m.saldoSql[0]} = $1`, [m.saldoSql[1]])).s;
      if (total > dec(saldo)) throw new ErrorApi(422, 'saldo_insuficiente', `${m.medio === 'transferencia' ? 'La cuenta' : 'La caja'} ${m.destino} tiene $ ${saldo} y se quieren sacar $ ${texto(total)}.`);
    }
  }
  const aCuenta = doc - ti;
  if (aCuenta > 0n) avisos.push(`Quedan $ ${texto(aCuenta)} sin imputar a ningún comprobante: quedan a cuenta del ${rol.tercero} (saldo a su favor).`);
  return { d, rol, tipoPago, tercero, fecha, imput, medios, rets, tm, tr, td, ti, doc, aCuenta, avisos };
}

const totales = (p) => ({ total_medios: texto(p.tm), total_retenciones: texto(p.tr), total_descuentos: texto(p.td), total_documento: texto(p.doc), total_imputado: texto(p.ti), a_cuenta: texto(p.aCuenta) });
export async function calcularPago(c, ctx, tipoPago, cuerpo) {
  const p = await prepararPago(c, ctx, tipoPago, cuerpo);
  return { tercero: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.fecha, ...totales(p), imputaciones: p.imput.map((x) => ({ comprobante_id: x.id, comprobante: x.nombre, importe: x.importe, saldo_antes: x.saldoAntes, saldo_despues: x.saldoDespues })), avisos: p.avisos };
}

export async function registrarPago(c, ctx, tipoPago, cuerpo, { claveIdempotencia } = {}) {
  const huella = createHash('sha256').update(tipoPago).update(JSON.stringify(cuerpo ?? null)).update(String(ctx.usuarioId)).digest('hex');
  if (claveIdempotencia) {
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(claveIdempotencia)) throw invalido({ 'Idempotency-Key': 'tiene que tener entre 8 y 100 caracteres (letras, números, . _ : -)' });
    const previo = await c.uno('select pago_id, huella from api_idempotencia where clave = $1', [claveIdempotencia]);
    if (previo) {
      if (previo.huella !== huella || !previo.pago_id) throw new ErrorApi(422, 'clave_reutilizada', 'Esa clave de idempotencia ya se usó con otro pedido.');
      return { pago: await detallePago(c, previo.pago_id, tipoPago), repetido: true, avisos: [] };
    }
  }
  const p = await prepararPago(c, ctx, tipoPago, cuerpo);
  const cab = await c.uno(`insert into pago (empresa_id, sentido, fecha, tercero_id, total_medios, total_retenciones, total_descuentos, total_imputado, observaciones, creado_por)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [ctx.empresaId, tipoPago, p.fecha, p.tercero.id, texto(p.tm), texto(p.tr), texto(p.td), texto(p.ti), p.d.observaciones ?? null, ctx.usuarioId]);
  for (const m of p.medios) await c.consultar('insert into pago_medio (empresa_id, pago_id, medio, caja_id, cuenta_bancaria_id, importe) values ($1,$2,$3,$4,$5,$6)', [ctx.empresaId, cab.id, m.medio, m.caja_id ?? null, m.cuenta_bancaria_id ?? null, m.importe]);
  for (const r of p.rets) await c.consultar('insert into retencion (empresa_id, pago_id, origen, tipo, jurisdiccion_codigo, base_imponible, alicuota, importe, certificado_numero, certificado_fecha) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [ctx.empresaId, cab.id, p.rol.retencion, r.tipo, r.jurisdiccion_codigo ?? null, r.base_imponible ?? null, r.alicuota ? texto(mul(dec(r.alicuota), dec('0.01')), 4) : null, r.importe, r.certificado_numero, r.certificado_fecha]);
  for (const x of p.imput) await c.consultar('insert into pago_imputacion (empresa_id, pago_id, comprobante_id, importe) values ($1,$2,$3,$4)', [ctx.empresaId, cab.id, x.id, x.importe]);
  await c.consultar(`update pago set estado = 'confirmado' where id = $1`, [cab.id]);          // la base verifica la identidad, genera el asiento y mueve la caja y el banco
  const pago = await detallePago(c, cab.id, tipoPago);
  await c.consultar(`select fn_registrar_evento('tesoreria', $1, $2, 'ok', $3, 'pago', $4)`,
    [`Registró ${pago.etiqueta}`, `${p.tercero.razon_social} · $ ${pago.total_documento}${p.imput.length ? ` · imputó a ${p.imput.length} comprobante${p.imput.length === 1 ? '' : 's'}` : ''}${p.rets.length ? ` · ${p.rets.length} retención${p.rets.length === 1 ? '' : 'es'}` : ''}${p.aCuenta > 0n ? ` · a cuenta $ ${texto(p.aCuenta)}` : ''}`, ctx.empresaId, cab.id]);
  if (claveIdempotencia) await c.consultar('insert into api_idempotencia (empresa_id, clave, usuario_id, huella, pago_id) values ($1,$2,$3,$4,$5)', [ctx.empresaId, claveIdempotencia, ctx.usuarioId, huella, cab.id]);
  return { pago, repetido: false, avisos: p.avisos };
}

export async function detallePago(c, id, tipoPago) {
  const rol = ROL[tipoPago];
  const f = await c.uno(`select p.id, p.sentido, p.punto_venta, p.numero, p.fecha::text as fecha, p.tercero_id, te.razon_social as tercero, p.total_medios::text total_medios, p.total_retenciones::text total_retenciones, p.total_descuentos::text total_descuentos,
      p.total_documento::text total_documento, p.total_imputado::text total_imputado, p.a_cuenta::text a_cuenta, p.estado, p.asiento_id, p.observaciones, p.motivo_anulacion, p.anulado_en, p.anulado_por, p.creado_en
    from pago p join tercero te on te.id = p.tercero_id where p.id = $1`, [id]);
  if (!f || f.sentido !== tipoPago) throw noEncontrado(tipoPago === 'cobro' ? 'El cobro' : 'El pago');
  const medios = await c.consultar(`select m.medio, m.importe::text importe, ca.nombre as caja, cb.banco, cb.numero_cuenta from pago_medio m left join caja ca on ca.id = m.caja_id left join cuenta_bancaria cb on cb.id = m.cuenta_bancaria_id where m.pago_id = $1 order by m.id`, [id]);
  const retenciones = await c.consultar(`select tipo, origen, jurisdiccion_codigo, importe::text importe, certificado_numero, certificado_fecha::text certificado_fecha from retencion where pago_id = $1 order by id`, [id]);
  const imputaciones = await c.consultar(`select i.comprobante_id, t.descripcion tipo, cb.punto_venta, cb.numero, i.importe::text importe from pago_imputacion i join comprobante cb on cb.id = i.comprobante_id join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo where i.pago_id = $1 order by i.id`, [id]);
  const asiento = f.asiento_id ? await c.uno('select id, numero, estado from asiento where id = $1', [f.asiento_id]) : null;
  const por = f.anulado_por ? (await c.uno('select nombre from usuario where id = $1', [f.anulado_por]))?.nombre : null;
  const { asiento_id, anulado_por, motivo_anulacion, anulado_en, sentido, ...resto } = f;
  return { ...resto, clase: tipoPago, etiqueta: `${rol.recibo} ${numeroFormateado(f.punto_venta, f.numero)}`, numero_formateado: numeroFormateado(f.punto_venta, f.numero), asiento,
    medios: medios.map((m) => ({ medio: m.medio, importe: m.importe, destino: m.caja ?? `${m.banco}${m.numero_cuenta ? ` ${m.numero_cuenta}` : ''}` })), retenciones,
    imputaciones: imputaciones.map((x) => ({ comprobante_id: x.comprobante_id, comprobante: `${x.tipo} ${x.numero == null ? '' : numeroFormateado(x.punto_venta, x.numero)}`.trim(), importe: x.importe })),
    anulacion: f.estado === 'anulado' ? { motivo: motivo_anulacion, en: anulado_en, por } : null };
}

export async function listarPagos(c, tipoPago, { estado, tercero_id, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (estado && !['confirmado', 'anulado'].includes(estado)) errores.estado = 'tiene que ser confirmado o anulado';
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (tercero_id && !/^\d{1,15}$/.test(String(tercero_id))) errores.tercero_id = 'tiene que ser un número';
  if (Object.keys(errores).length) throw invalido(errores);
  const p = [tipoPago, estado || null, tercero_id ? Number(tercero_id) : null, desde || null, hasta || null];
  const filtros = `p.sentido = $1 and p.estado <> 'borrador' and ($2::text is null or p.estado = $2) and ($3::bigint is null or p.tercero_id = $3) and ($4::date is null or p.fecha >= $4) and ($5::date is null or p.fecha <= $5)`;
  const filas = await c.consultar(`select p.id, p.punto_venta, p.numero, p.fecha::text as fecha, p.tercero_id, te.razon_social as tercero, p.total_documento::text total_documento, p.total_imputado::text total_imputado, p.a_cuenta::text a_cuenta, p.estado
    from pago p join tercero te on te.id = p.tercero_id where ${filtros} order by p.fecha desc, p.id desc limit ${lim} offset ${des}`, p);
  return { datos: filas.map((f) => ({ ...f, numero_formateado: numeroFormateado(f.punto_venta, f.numero) })), total: (await c.uno(`select count(*)::int n from pago p where ${filtros}`, p)).n, limite: lim, desplazamiento: des };
}

/* Lo que se le puede imputar a un cobro o a un pago: las deudas confirmadas con saldo, de la más vieja a la más nueva. */
export async function listarPendientes(c, tipoPago, { tercero_id } = {}) {
  if (!tercero_id || !/^\d{1,15}$/.test(String(tercero_id))) throw invalido({ tercero_id: 'indicá el ' + ROL[tipoPago].tercero });
  const filas = await c.consultar(`select cb.id, t.descripcion as tipo, cb.punto_venta, cb.numero, cb.fecha::text as fecha, cb.fecha_vto_pago::text as vencimiento, cb.imp_total::text as total, v.saldo::text as saldo
    from comprobante cb join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo join v_saldo_comprobante v on v.comprobante_id = cb.id
    where cb.sentido = $1 and cb.tercero_id = $2 and t.signo = 1 and v.saldo > 0 order by cb.fecha, cb.id`, [ROL[tipoPago].sentido, Number(tercero_id)]);
  return { datos: filas.map((f) => ({ ...f, numero_formateado: numeroFormateado(f.punto_venta, f.numero) })), total_pendiente: texto(filas.reduce((s, f) => s + dec(f.saldo), 0n)) };
}

export async function anularPago(c, ctx, id, tipoPago, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const f = await c.uno(`select p.id, p.sentido, p.estado, p.punto_venta, p.numero, p.total_documento::text total, te.razon_social as tercero from pago p join tercero te on te.id = p.tercero_id where p.id = $1 for update of p`, [id]);
  if (!f || f.sentido !== tipoPago) throw noEncontrado(tipoPago === 'cobro' ? 'El cobro' : 'El pago');
  if (f.estado === 'anulado') throw new ErrorApi(422, 'no_se_puede_anular', 'Ya está anulado.');
  if (f.estado !== 'confirmado') throw new ErrorApi(422, 'no_se_puede_anular', `Un pago ${f.estado} no se anula.`);
  const per = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, hoyISO()])).p;
  if (per !== 'ok') throw new ErrorApi(422, 'periodo_no_abierto', 'El período de hoy no está abierto: no se puede registrar el contraasiento de la anulación.');
  if (tipoPago === 'cobro') {                  // el dinero que había entrado tiene que seguir estando
    const medios = await c.consultar(`select m.caja_id, m.cuenta_bancaria_id, sum(m.importe)::text as total, coalesce(ca.nombre, cb.banco) as nombre,
        coalesce((select sum(t.importe) from movimiento_tesoreria t where t.caja_id = m.caja_id or t.cuenta_bancaria_id = m.cuenta_bancaria_id), 0)::text as saldo
      from pago_medio m left join caja ca on ca.id = m.caja_id left join cuenta_bancaria cb on cb.id = m.cuenta_bancaria_id where m.pago_id = $1 group by m.caja_id, m.cuenta_bancaria_id, ca.nombre, cb.banco`, [id]);
    for (const m of medios) if (dec(m.total) > dec(m.saldo)) throw new ErrorApi(422, 'saldo_insuficiente', `No se puede anular: ${m.nombre} tiene $ ${m.saldo} y habría que devolver $ ${m.total}.`);
  }
  const etiqueta = `${ROL[tipoPago].recibo} ${numeroFormateado(f.punto_venta, f.numero)}`;
  await c.consultar(`update pago set estado = 'anulado', motivo_anulacion = $2, anulado_en = now(), anulado_por = $3 where id = $1`, [id, d.motivo, ctx.usuarioId]);       // la base contrarresta el asiento y los movimientos de caja y banco
  return { pago: await detallePago(c, id, tipoPago), etiqueta, tercero: f.tercero, total: f.total, motivo: d.motivo };
}

/* ====================== cuenta corriente ====================== */
export async function cuentaCorriente(c, terceroId, rolTercero) {
  const sentido = rolTercero === 'cliente' ? 'venta' : 'compra', tipoPago = rolTercero === 'cliente' ? 'cobro' : 'pago';
  const t = await c.uno(`select id, razon_social from tercero where id = $1 and ${rolTercero === 'cliente' ? 'es_cliente' : 'es_proveedor'}`, [terceroId]);
  if (!t) throw noEncontrado(rolTercero === 'cliente' ? 'El cliente' : 'El proveedor');
  const filas = await c.consultar(`select * from (
      select cb.fecha::text as fecha, cb.id as orden, 'comprobante' as clase, cb.id as ref, tc.descripcion || ' ' || lpad(cb.punto_venta::text, 4, '0') || '-' || lpad(cb.numero::text, 8, '0') as detalle, (tc.signo * cb.imp_total)::text as importe
        from comprobante cb join arca_tipo_comprobante tc on tc.codigo = cb.tipo_comprobante_codigo where cb.tercero_id = $1 and cb.sentido = $2 and cb.estado in ('confirmado','autorizado')
      union all
      select p.fecha::text, p.id, 'pago', p.id, case p.sentido when 'cobro' then 'Recibo ' else 'Orden de pago ' end || lpad(p.punto_venta::text, 4, '0') || '-' || lpad(p.numero::text, 8, '0'), (-p.total_documento)::text
        from pago p where p.tercero_id = $1 and p.sentido = $3 and p.estado = 'confirmado') x order by fecha, clase, orden`, [terceroId, sentido, tipoPago]);
  let acumulado = 0n;
  const movimientos = filas.map((f) => { acumulado += dec(f.importe); return { fecha: f.fecha, clase: f.clase, id: f.ref, detalle: f.detalle, importe: f.importe, saldo: texto(acumulado) }; });
  return { tercero: t, saldo: texto(acumulado), movimientos };
}
