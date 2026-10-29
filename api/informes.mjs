// Informes contables: libros de IVA, posición de IVA, balance de sumas y saldos, libro mayor, libro diario, estados contables, antigüedad de deuda
// y retenciones. Son de solo lectura y se DERIVAN de lo ya registrado (vistas y asientos): nada se guarda. Los importes salen como texto decimal
// exacto y los totales se suman con aritmética entera, igual que en el resto del sistema. Cada informe puede bajarse a CSV con los mismos filtros.
// Solo cuentan los asientos contabilizados; los comprobantes anulados no figuran en los libros de IVA (se avisa cuántos hay).
import { invalido, noEncontrado, ErrorApi } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { dec, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const TOPE = 5000;                                   // filas por informe en pantalla y en CSV: más que eso se acota con fechas
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const sumar = (filas, clave) => texto(filas.reduce((s, f) => s + dec(f[clave] ?? '0'), 0n));
const sumas = (filas, claves) => Object.fromEntries(claves.map((k) => [k, sumar(filas, k)]));

/** Período del informe: por defecto, lo que va del mes. */
function rango(q, { inicio } = {}) {
  const hoy = hoyISO(), errores = {};
  const desde = q.desde || inicio || `${hoy.slice(0, 8)}01`, hasta = q.hasta || hoy;
  if (!esFecha(desde)) errores.desde = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (!esFecha(hasta)) errores.hasta = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (!Object.keys(errores).length && desde > hasta) errores.hasta = 'no puede ser anterior a la fecha de inicio';
  if (Object.keys(errores).length) throw invalido(errores);
  return { desde, hasta };
}
const entero = (v, campo) => { if (v === undefined || v === '') return null; if (!/^\d{1,15}$/.test(String(v))) throw invalido({ [campo]: 'tiene que ser un número' }); return Number(v); };
const cortar = (n, que) => { if (n > TOPE) throw new ErrorApi(422, 'demasiadas_filas', `${que} tiene más de ${TOPE.toLocaleString('es-AR')} filas: acotá las fechas.`); };

/* ====================== IVA ====================== */
const COLUMNAS_IVA = ['neto_gravado', 'iva_2_5', 'iva_5', 'iva_10_5', 'iva_21', 'iva_27', 'iva_total', 'no_gravado', 'exento', 'percepcion_iva', 'percepcion_iibb', 'percepcion_ganancias', 'otros_tributos', 'total'];
const TITULO_IVA = { neto_gravado: 'Neto gravado', iva_2_5: 'IVA 2,5%', iva_5: 'IVA 5%', iva_10_5: 'IVA 10,5%', iva_21: 'IVA 21%', iva_27: 'IVA 27%', iva_total: 'IVA total', no_gravado: 'No gravado', exento: 'Exento', percepcion_iva: 'Perc. IVA', percepcion_iibb: 'Perc. IIBB', percepcion_ganancias: 'Perc. Ganancias', otros_tributos: 'Otros tributos', total: 'Total' };

async function libroIva(c, sentido, q) {
  const { desde, hasta } = rango(q);
  const filas = await c.consultar(`select fecha::text as fecha, comprobante_id, tipo, punto_venta, numero, razon_social, nro_documento, ${COLUMNAS_IVA.map((k) => `${k}::text as ${k}`).join(', ')}
    from v_libro_iva where sentido = $1 and fecha between $2 and $3 order by fecha, punto_venta, numero, comprobante_id limit ${TOPE + 1}`, [sentido, desde, hasta]);
  cortar(filas.length, 'El libro');
  const anulados = (await c.uno(`select count(*)::int n from comprobante where sentido = $1 and estado = 'anulado' and fecha between $2 and $3`, [sentido, desde, hasta])).n;
  const datos = filas.map((f) => ({ ...f, numero_formateado: f.numero == null ? '' : numeroFormateado(f.punto_venta, f.numero) }));
  return { desde, hasta, sentido, filas: datos, totales: sumas(filas, COLUMNAS_IVA), cantidad: datos.length, avisos: anulados ? [`Hay ${anulados} comprobante${anulados === 1 ? '' : 's'} anulado${anulados === 1 ? '' : 's'} en el período que no figura${anulados === 1 ? '' : 'n'} en el libro.`] : [] };
}
const columnasLibro = [['fecha', 'Fecha'], ['tipo', 'Tipo'], ['numero_formateado', 'Número'], ['razon_social', 'Razón social'], ['nro_documento', 'Documento'], ...COLUMNAS_IVA.map((k) => [k, TITULO_IVA[k]])];

async function posicionIva(c, q) {
  const { desde, hasta } = rango(q, { inicio: `${hoyISO().slice(0, 4)}-01-01` });
  const filas = await c.consultar(`select mes::text as mes, debito::text debito, credito::text credito, saldo_tecnico::text saldo_tecnico, retencion::text retencion, percepcion::text percepcion, saldo::text saldo
    from v_posicion_iva where mes between date_trunc('month', $1::date) and $2::date order by mes`, [desde, hasta]);
  return { desde, hasta, filas, totales: sumas(filas, ['debito', 'credito', 'saldo_tecnico', 'retencion', 'percepcion', 'saldo']),
    avisos: ['El saldo es el débito menos el crédito, la retención de IVA sufrida y la percepción de IVA sufrida del mes. No incluye saldos a favor de meses anteriores.'] };
}
const columnasPosicion = [['mes', 'Mes'], ['debito', 'Débito fiscal'], ['credito', 'Crédito fiscal'], ['saldo_tecnico', 'Saldo técnico'], ['retencion', 'Retenciones sufridas'], ['percepcion', 'Percepciones sufridas'], ['saldo', 'Saldo a pagar (a favor si es negativo)']];

/* ====================== contabilidad ====================== */
/** Las cuentas de resultado arrancan de cero con cada ejercicio: el saldo anterior de ingresos y egresos cuenta solo desde el inicio del ejercicio. */
const inicioEjercicio = async (c, fecha) => (await c.uno('select desde::text d from ejercicio where $1::date between desde and hasta', [fecha]))?.d ?? `${fecha.slice(0, 4)}-01-01`;   // sin ejercicio cargado: el año calendario

async function balance(c, q) {
  const { desde, hasta } = rango(q, { inicio: `${hoyISO().slice(0, 4)}-01-01` });
  const ini = await inicioEjercicio(c, desde);
  const filas = await c.consultar(`select * from (
      select pc.id as cuenta_id, pc.codigo, pc.nombre, pc.tipo,
             coalesce(sum(l.debe - l.haber) filter (where a.fecha < $1 and (pc.tipo not in ('ingreso','egreso') or a.fecha >= $3)), 0)::text as saldo_anterior,
             coalesce(sum(l.debe) filter (where a.fecha between $1 and $2 and a.origen_tipo is distinct from 'cierre'), 0)::text as debe,
             coalesce(sum(l.haber) filter (where a.fecha between $1 and $2 and a.origen_tipo is distinct from 'cierre'), 0)::text as haber
        from plan_cuenta pc left join asiento_linea l on l.cuenta_id = pc.id left join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado'
       group by pc.id) x
    where saldo_anterior::numeric <> 0 or debe::numeric <> 0 or haber::numeric <> 0 order by codigo`, [desde, hasta, ini]);
  const datos = filas.map((x) => { const f = { ...x, saldo_anterior: texto(dec(x.saldo_anterior)), debe: texto(dec(x.debe)), haber: texto(dec(x.haber)) }, final = dec(f.saldo_anterior) + dec(f.debe) - dec(f.haber);
    return { ...f, saldo_final: texto(final), saldo_deudor: final > 0n ? texto(final) : '0.00', saldo_acreedor: final < 0n ? texto(-final) : '0.00' }; });
  const totales = sumas(datos, ['debe', 'haber', 'saldo_deudor', 'saldo_acreedor']);
  const avisos = [];
  if (totales.debe !== totales.haber) avisos.push(`Atención: el debe ($ ${totales.debe}) y el haber ($ ${totales.haber}) del período no coinciden.`);
  if (totales.saldo_deudor !== totales.saldo_acreedor) avisos.push(`Atención: los saldos deudores ($ ${totales.saldo_deudor}) y acreedores ($ ${totales.saldo_acreedor}) no coinciden.`);
  return { desde, hasta, filas: datos, totales, avisos };
}
const columnasBalance = [['codigo', 'Código'], ['nombre', 'Cuenta'], ['saldo_anterior', 'Saldo anterior'], ['debe', 'Debe'], ['haber', 'Haber'], ['saldo_deudor', 'Saldo deudor'], ['saldo_acreedor', 'Saldo acreedor']];

async function mayor(c, q) {
  const cuentaId = entero(q.cuenta_id, 'cuenta_id');
  if (!cuentaId) throw invalido({ cuenta_id: 'elegí la cuenta' });
  const cuenta = await c.uno('select id, codigo, nombre, tipo from plan_cuenta where id = $1', [cuentaId]);
  if (!cuenta) throw noEncontrado('La cuenta');
  const { desde, hasta } = rango(q, { inicio: `${hoyISO().slice(0, 4)}-01-01` });
  const ini = await inicioEjercicio(c, desde), resultado = cuenta.tipo === 'ingreso' || cuenta.tipo === 'egreso';
  const anterior = dec((await c.uno(`select coalesce(sum(l.debe - l.haber), 0)::text s from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado'
    where l.cuenta_id = $1 and a.fecha < $2 and ($4::boolean is false or a.fecha >= $3)`, [cuentaId, desde, ini, resultado])).s);
  const lineas = await c.consultar(`select a.fecha::text as fecha, a.numero, a.descripcion, l.detalle, te.razon_social as tercero, l.debe::text as debe, l.haber::text as haber
    from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado' left join tercero te on te.id = l.tercero_id
    where l.cuenta_id = $1 and a.fecha between $2 and $3 order by a.fecha, a.ejercicio_id, a.numero, l.id limit ${TOPE + 1}`, [cuentaId, desde, hasta]);
  cortar(lineas.length, 'El mayor');
  let acumulado = anterior;
  const filas = lineas.map((f) => { acumulado += dec(f.debe) - dec(f.haber); return { ...f, saldo: texto(acumulado) }; });
  return { desde, hasta, cuenta, saldo_anterior: texto(anterior), filas, totales: { ...sumas(lineas, ['debe', 'haber']), saldo_final: texto(acumulado) }, avisos: [] };
}
const columnasMayor = [['fecha', 'Fecha'], ['numero', 'Asiento'], ['descripcion', 'Descripción'], ['detalle', 'Detalle'], ['tercero', 'Persona'], ['debe', 'Debe'], ['haber', 'Haber'], ['saldo', 'Saldo']];

async function diario(c, q, { paraCsv = false } = {}) {
  const { desde, hasta } = rango(q);
  const lim = paraCsv ? TOPE : Math.min(Math.max(Number(q.limite) || 50, 1), 200), des = paraCsv ? 0 : Math.max(Number(q.desplazamiento) || 0, 0);
  const asientos = await c.consultar(`select id, numero, fecha::text as fecha, descripcion, origen_tipo from asiento where estado = 'contabilizado' and fecha between $1 and $2
    order by fecha, ejercicio_id, numero limit ${lim} offset ${des}`, [desde, hasta]);
  const total = (await c.uno(`select count(*)::int n from asiento where estado = 'contabilizado' and fecha between $1 and $2`, [desde, hasta])).n;
  if (paraCsv && total > TOPE) throw new ErrorApi(422, 'demasiadas_filas', `El libro diario tiene más de ${TOPE.toLocaleString('es-AR')} asientos en el período: acotá las fechas.`);
  const lineas = asientos.length ? await c.consultar(`select l.asiento_id, pc.codigo, pc.nombre as cuenta, l.detalle, l.debe::text as debe, l.haber::text as haber
    from asiento_linea l join plan_cuenta pc on pc.id = l.cuenta_id where l.asiento_id = any($1::bigint[]) order by l.asiento_id, l.id`, [asientos.map((a) => a.id)]) : [];
  const datos = asientos.map((a) => ({ ...a, lineas: lineas.filter((l) => l.asiento_id === a.id).map(({ asiento_id, ...l }) => l) }));
  return { desde, hasta, filas: datos, total, limite: lim, desplazamiento: des, totales: sumas(lineas, ['debe', 'haber']), avisos: [] };
}
const columnasDiario = [['fecha', 'Fecha'], ['numero', 'Asiento'], ['descripcion', 'Descripción'], ['codigo', 'Código'], ['cuenta', 'Cuenta'], ['detalle', 'Detalle'], ['debe', 'Debe'], ['haber', 'Haber']];
const filasDiario = (r) => r.filas.flatMap((a) => a.lineas.map((l) => ({ fecha: a.fecha, numero: a.numero, descripcion: a.descripcion, ...l })));

/** Estado de resultados del período y situación patrimonial a la fecha de cierre. */
async function estadosContables(c, q) {
  const { desde, hasta } = rango(q, { inicio: `${hoyISO().slice(0, 4)}-01-01` });
  const res = await c.consultar(`select pc.codigo, pc.nombre, pc.tipo, sum(l.debe - l.haber)::text as neto from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado'
    join plan_cuenta pc on pc.id = l.cuenta_id where pc.tipo in ('ingreso','egreso') and a.fecha between $1 and $2 and a.origen_tipo is distinct from 'cierre' group by pc.id order by pc.codigo`, [desde, hasta]);
  const sit = await c.consultar(`select pc.codigo, pc.nombre, pc.tipo, sum(l.debe - l.haber)::text as neto from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado'
    join plan_cuenta pc on pc.id = l.cuenta_id where a.fecha <= $1 group by pc.id order by pc.codigo`, [hasta]);
  const monto = (f, signo) => ({ codigo: f.codigo, nombre: f.nombre, importe: texto(BigInt(signo) * dec(f.neto)) });
  const de = (filas, tipos, signo) => filas.filter((f) => tipos.includes(f.tipo)).map((f) => monto(f, signo)).filter((f) => dec(f.importe) !== 0n);
  const total = (filas) => sumar(filas, 'importe');
  const ingresos = de(res, ['ingreso'], -1), egresos = de(res, ['egreso'], 1);
  const activo = de(sit, ['activo'], 1), pasivo = de(sit, ['pasivo'], -1), patrimonio = de(sit, ['patrimonio_neto'], -1);
  const acumulado = texto(-sit.filter((f) => f.tipo === 'ingreso' || f.tipo === 'egreso').reduce((s, f) => s + dec(f.neto), 0n));
  const pasivoMasPn = texto(dec(total(pasivo)) + dec(total(patrimonio)) + dec(acumulado));
  const diferencia = texto(dec(total(activo)) - dec(pasivoMasPn));
  return {
    desde, hasta,
    resultados: { ingresos, total_ingresos: total(ingresos), egresos, total_egresos: total(egresos), resultado: texto(dec(total(ingresos)) - dec(total(egresos))) },
    situacion: { al: hasta, activo, total_activo: total(activo), pasivo, total_pasivo: total(pasivo), patrimonio_neto: patrimonio, total_patrimonio_neto: total(patrimonio), resultados_acumulados: acumulado, total_pasivo_y_patrimonio: pasivoMasPn, diferencia },
    avisos: [...(diferencia !== '0.00' ? [`Atención: el activo y el pasivo más el patrimonio no coinciden (diferencia $ ${diferencia}).`] : []), 'Los resultados acumulados suman los ingresos y egresos de los ejercicios que todavía no se cerraron; el de uno cerrado ya está en Resultados no asignados. Los informes del año muestran sus resultados sin el asiento de cierre.'],
  };
}
const columnasEstados = [['seccion', 'Sección'], ['codigo', 'Código'], ['nombre', 'Cuenta'], ['importe', 'Importe']];
const filasEstados = (r) => {
  const sec = (seccion, filas) => filas.map((f) => ({ seccion, ...f }));
  return [...sec('Ingresos', r.resultados.ingresos), { seccion: 'Total ingresos', importe: r.resultados.total_ingresos }, ...sec('Egresos', r.resultados.egresos), { seccion: 'Total egresos', importe: r.resultados.total_egresos }, { seccion: 'Resultado del período', importe: r.resultados.resultado },
    ...sec('Activo', r.situacion.activo), { seccion: 'Total activo', importe: r.situacion.total_activo }, ...sec('Pasivo', r.situacion.pasivo), { seccion: 'Total pasivo', importe: r.situacion.total_pasivo },
    ...sec('Patrimonio neto', r.situacion.patrimonio_neto), { seccion: 'Resultados acumulados', importe: r.situacion.resultados_acumulados }, { seccion: 'Total pasivo y patrimonio', importe: r.situacion.total_pasivo_y_patrimonio }];
};

/* ====================== deudas y retenciones ====================== */
const TRAMOS = ['a_vencer', 'vencido_1_30', 'vencido_31_60', 'vencido_61_90', 'vencido_mas_90'];
async function antiguedad(c, rol, q) {
  const hoy = hoyISO(), sentido = rol === 'cliente' ? 'venta' : 'compra';
  const filas = await c.consultar(`with d as (
      select cb.tercero_id, v.saldo, ($2::date - coalesce(cb.fecha_vto_pago, cb.fecha)) as atraso
        from comprobante cb join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo join v_saldo_comprobante v on v.comprobante_id = cb.id
       where cb.sentido = $1 and t.signo = 1 and v.saldo > 0)
    select te.id as tercero_id, te.razon_social, te.nro_documento,
           coalesce(sum(d.saldo) filter (where d.atraso <= 0), 0)::text as a_vencer,
           coalesce(sum(d.saldo) filter (where d.atraso between 1 and 30), 0)::text as vencido_1_30,
           coalesce(sum(d.saldo) filter (where d.atraso between 31 and 60), 0)::text as vencido_31_60,
           coalesce(sum(d.saldo) filter (where d.atraso between 61 and 90), 0)::text as vencido_61_90,
           coalesce(sum(d.saldo) filter (where d.atraso > 90), 0)::text as vencido_mas_90,
           sum(d.saldo)::text as deuda,
           coalesce((select s.saldo from v_saldo_tercero s where s.tercero_id = te.id and s.rol = $3), 0)::text as saldo_neto
      from d join tercero te on te.id = d.tercero_id group by te.id order by sum(d.saldo) desc, te.razon_social limit ${TOPE + 1}`, [sentido, hoy, rol]);
  cortar(filas.length, 'El informe');
  const datos = filas.map((x) => { const f = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, [...TRAMOS, 'deuda', 'saldo_neto'].includes(k) ? texto(dec(v)) : v])); return { ...f, sin_aplicar: texto(dec(f.saldo_neto) - dec(f.deuda)) }; });
  return { al: hoy, rol, filas: datos, totales: sumas(datos, [...TRAMOS, 'deuda', 'saldo_neto', 'sin_aplicar']),
    avisos: ['El vencimiento es el de la factura (o su fecha, si no tiene). "Sin aplicar" en negativo son notas de crédito y pagos a cuenta que todavía no se imputaron a una factura; en positivo, cheques rechazados que el cliente sigue debiendo.'] };
}
const columnasAntiguedad = [['razon_social', 'Razón social'], ['nro_documento', 'Documento'], ['a_vencer', 'A vencer'], ['vencido_1_30', 'Vencido 1-30 días'], ['vencido_31_60', 'Vencido 31-60'], ['vencido_61_90', 'Vencido 61-90'], ['vencido_mas_90', 'Vencido más de 90'], ['deuda', 'Deuda'], ['sin_aplicar', 'Sin aplicar'], ['saldo_neto', 'Saldo neto']];

async function retenciones(c, q) {
  const { desde, hasta } = rango(q);
  const errores = {};
  if (q.origen && !['sufrida', 'practicada'].includes(q.origen)) errores.origen = 'tiene que ser sufrida o practicada';
  if (q.tipo && !['iva', 'ganancias', 'iibb', 'suss'].includes(q.tipo)) errores.tipo = 'tiene que ser iva, ganancias, iibb o suss';
  if (Object.keys(errores).length) throw invalido(errores);
  const filas = await c.consultar(`select p.fecha::text as fecha, r.origen, r.tipo, j.nombre as jurisdiccion, r.base_imponible::text as base_imponible, r.alicuota::text as alicuota, r.importe::text as importe,
      r.certificado_numero, r.certificado_fecha::text as certificado_fecha, te.razon_social, te.tipo_documento_codigo, te.nro_documento, rr.codigo_arca as regimen_codigo, rr.descripcion as regimen, p.sentido, p.punto_venta, p.numero as numero_pago
    from retencion r join pago p on p.id = r.pago_id and p.estado = 'confirmado' join tercero te on te.id = p.tercero_id left join arca_jurisdiccion j on j.codigo = r.jurisdiccion_codigo left join regimen_retencion rr on rr.id = r.regimen_id
    where p.fecha between $1 and $2 and ($3::text is null or r.origen = $3) and ($4::text is null or r.tipo = $4) order by p.fecha, p.id, r.id limit ${TOPE + 1}`, [desde, hasta, q.origen || null, q.tipo || null]);
  cortar(filas.length, 'El informe');
  const datos = filas.map(({ sentido, punto_venta, numero_pago, ...f }) => ({ ...f, comprobante: `${sentido === 'cobro' ? 'Recibo' : 'Orden de pago'} ${numeroFormateado(punto_venta, numero_pago)}` }));
  const resumen = [];
  for (const f of datos) { let r = resumen.find((x) => x.origen === f.origen && x.tipo === f.tipo); if (!r) resumen.push(r = { origen: f.origen, tipo: f.tipo, cantidad: 0, importe: '0.00' }); r.cantidad++; r.importe = texto(dec(r.importe) + dec(f.importe)); }
  return { desde, hasta, filas: datos, resumen, totales: sumas(datos, ['importe']), avisos: [] };
}
const columnasRetenciones = [['fecha', 'Fecha'], ['origen', 'Origen'], ['tipo', 'Impuesto'], ['jurisdiccion', 'Jurisdicción'], ['razon_social', 'Persona'], ['tipo_documento_codigo', 'Tipo doc. (código ARCA)'], ['nro_documento', 'Documento'], ['regimen_codigo', 'Régimen (código)'], ['regimen', 'Régimen'], ['comprobante', 'Comprobante'], ['certificado_numero', 'Certificado'], ['certificado_fecha', 'Fecha del certificado'], ['base_imponible', 'Base imponible'], ['alicuota', 'Alícuota'], ['importe', 'Importe']];

/* ====================== planillas fiscales ====================== */
// Planillas de trabajo con los campos que piden los aplicativos de ARCA (Libro IVA Digital, SIFERE, SICORE). NO son el archivo de importación oficial: ese tiene un diseño de
// registro propio que no está verificado acá. Sirven para controlar y para cargar o convertir. Las notas de crédito van en negativo, igual que en los libros.
const AVISO_PLANILLA = 'Planilla de trabajo con los campos que piden los aplicativos de ARCA: no es el archivo de importación oficial (su diseño de registro no está verificado).';
const MONTOS_DETALLE = ['total', 'no_gravado', 'exento', 'neto_gravado', 'iva_total', 'percepcion_iva', 'percepcion_iibb', 'percepcion_ganancias', 'otros_tributos'];
async function ivaDetalle(c, sentido, q) {
  const { desde, hasta } = rango(q);
  const filas = await c.consultar(`select v.fecha::text as fecha, cb.tipo_comprobante_codigo, v.tipo, v.punto_venta, v.numero, te.tipo_documento_codigo, v.nro_documento, v.razon_social, cb.moneda, cb.cotizacion::text as cotizacion,
      v.total::text as total, v.no_gravado::text as no_gravado, v.exento::text as exento, v.neto_gravado::text as neto_gravado, v.iva_total::text as iva_total,
      v.percepcion_iva::text as percepcion_iva, v.percepcion_iibb::text as percepcion_iibb, v.percepcion_ganancias::text as percepcion_ganancias, v.otros_tributos::text as otros_tributos,
      (select count(*)::int from comprobante_iva ci where ci.comprobante_id = v.comprobante_id) as cant_alicuotas
    from v_libro_iva v join comprobante cb on cb.id = v.comprobante_id join tercero te on te.id = cb.tercero_id
    where v.sentido = $1 and v.fecha between $2 and $3 order by v.fecha, v.punto_venta, v.numero, v.comprobante_id limit ${TOPE + 1}`, [sentido, desde, hasta]);
  cortar(filas.length, 'La planilla');
  const datos = filas.map((f) => ({ ...f, punto_venta: String(f.punto_venta).padStart(4, '0'), numero: f.numero == null ? '' : String(f.numero).padStart(8, '0') }));
  return { desde, hasta, sentido, filas: datos, totales: sumas(filas, MONTOS_DETALLE), cantidad: datos.length, avisos: [AVISO_PLANILLA] };
}
const columnasIvaDetalle = [['fecha', 'Fecha'], ['tipo_comprobante_codigo', 'Tipo (código ARCA)'], ['tipo', 'Tipo'], ['punto_venta', 'Punto de venta'], ['numero', 'Número'], ['tipo_documento_codigo', 'Tipo doc. (código ARCA)'], ['nro_documento', 'Documento'],
  ['razon_social', 'Razón social'], ['moneda', 'Moneda'], ['cotizacion', 'Cotización'], ['total', 'Total'], ['no_gravado', 'No gravado'], ['exento', 'Exento'], ['neto_gravado', 'Neto gravado'], ['iva_total', 'IVA'],
  ['percepcion_iva', 'Percepción IVA'], ['percepcion_iibb', 'Percepción IIBB'], ['percepcion_ganancias', 'Percepción Ganancias'], ['otros_tributos', 'Otros tributos'], ['cant_alicuotas', 'Cant. de alícuotas']];

async function ivaAlicuotas(c, sentido, q) {
  const { desde, hasta } = rango(q);
  const filas = await c.consultar(`select v.fecha::text as fecha, cb.tipo_comprobante_codigo, v.tipo, v.punto_venta, v.numero, v.nro_documento, v.razon_social, ci.alicuota_codigo, a.descripcion as alicuota,
      (t.signo * ci.base_imponible)::text as neto_gravado, (t.signo * ci.importe_iva)::text as iva
    from comprobante_iva ci join v_libro_iva v on v.comprobante_id = ci.comprobante_id join comprobante cb on cb.id = ci.comprobante_id join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo
      join arca_alicuota_iva a on a.codigo = ci.alicuota_codigo
    where v.sentido = $1 and v.fecha between $2 and $3 order by v.fecha, v.punto_venta, v.numero, v.comprobante_id, ci.alicuota_codigo limit ${TOPE + 1}`, [sentido, desde, hasta]);
  cortar(filas.length, 'La planilla');
  const datos = filas.map((f) => ({ ...f, punto_venta: String(f.punto_venta).padStart(4, '0'), numero: f.numero == null ? '' : String(f.numero).padStart(8, '0') }));
  return { desde, hasta, sentido, filas: datos, totales: sumas(filas, ['neto_gravado', 'iva']), cantidad: datos.length,
    avisos: [AVISO_PLANILLA, 'Una fila por comprobante y alícuota. Los comprobantes sin IVA discriminado (exentos, no gravados) no tienen fila.'] };
}
const columnasIvaAlicuotas = [['fecha', 'Fecha'], ['tipo_comprobante_codigo', 'Tipo (código ARCA)'], ['tipo', 'Tipo'], ['punto_venta', 'Punto de venta'], ['numero', 'Número'], ['nro_documento', 'Documento'], ['razon_social', 'Razón social'],
  ['alicuota_codigo', 'Alícuota (código ARCA)'], ['alicuota', 'Alícuota'], ['neto_gravado', 'Neto gravado'], ['iva', 'IVA']];

const IMPUESTO_PERCEPCION = { iva: 'IVA', iibb: 'Ingresos Brutos', ganancias: 'Ganancias', suss: 'SUSS' };
async function percepciones(c, q) {
  const { desde, hasta } = rango(q), errores = {};
  if (q.origen && !['sufrida', 'practicada'].includes(q.origen)) errores.origen = 'tiene que ser sufrida o practicada';
  if (q.impuesto && !IMPUESTO_PERCEPCION[q.impuesto]) errores.impuesto = 'tiene que ser iva, iibb, ganancias o suss';
  if (Object.keys(errores).length) throw invalido(errores);
  const filas = await c.consultar(`select cb.fecha::text as fecha, case cb.sentido when 'compra' then 'sufrida' else 'practicada' end as origen, substr(ct.tipo, 12) as impuesto, j.nombre as jurisdiccion,
      te.tipo_documento_codigo, te.nro_documento, te.razon_social, t.descripcion as tipo, cb.punto_venta, cb.numero,
      (t.signo * coalesce(ct.base_imponible, 0))::text as base_imponible, ct.alicuota::text as alicuota, (t.signo * ct.importe)::text as importe
    from comprobante_tributo ct join comprobante cb on cb.id = ct.comprobante_id and cb.estado in ('confirmado', 'autorizado') join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo
      join tercero te on te.id = cb.tercero_id left join arca_jurisdiccion j on j.codigo = ct.jurisdiccion_codigo
    where ct.tipo like 'percepcion\\_%' and cb.fecha between $1 and $2 and ($3::text is null or cb.sentido = case $3 when 'sufrida' then 'compra' else 'venta' end) and ($4::text is null or ct.tipo = 'percepcion_' || $4)
    order by cb.fecha, cb.id, ct.id limit ${TOPE + 1}`, [desde, hasta, q.origen || null, q.impuesto || null]);
  cortar(filas.length, 'El informe');
  const datos = filas.map(({ tipo, punto_venta, numero, impuesto, ...f }) => ({ ...f, impuesto: IMPUESTO_PERCEPCION[impuesto] ?? impuesto, comprobante: `${tipo} ${numero == null ? '' : numeroFormateado(punto_venta, numero)}`.trim() }));
  const resumen = [];
  for (const f of datos) {
    let r = resumen.find((x) => x.origen === f.origen && x.impuesto === f.impuesto && x.jurisdiccion === f.jurisdiccion);
    if (!r) resumen.push(r = { origen: f.origen, impuesto: f.impuesto, jurisdiccion: f.jurisdiccion, cantidad: 0, importe: '0.00' });
    r.cantidad++; r.importe = texto(dec(r.importe) + dec(f.importe));
  }
  return { desde, hasta, filas: datos, resumen, totales: sumas(datos, ['base_imponible', 'importe']), avisos: [AVISO_PLANILLA, 'Las que se sufrieron son las de las facturas de compra; las practicadas, las de las ventas. Las notas de crédito restan.'] };
}
const columnasPercepciones = [['fecha', 'Fecha'], ['origen', 'Origen'], ['impuesto', 'Impuesto'], ['jurisdiccion', 'Jurisdicción'], ['razon_social', 'Persona'], ['tipo_documento_codigo', 'Tipo doc. (código ARCA)'], ['nro_documento', 'Documento'],
  ['comprobante', 'Comprobante'], ['base_imponible', 'Base imponible'], ['alicuota', 'Alícuota'], ['importe', 'Importe']];

/* ====================== catálogo y CSV ====================== */
export const INFORMES = {
  'libro-iva-ventas': { titulo: 'Libro de IVA ventas', generar: (c, q) => libroIva(c, 'venta', q), columnas: columnasLibro },
  'libro-iva-compras': { titulo: 'Libro de IVA compras', generar: (c, q) => libroIva(c, 'compra', q), columnas: columnasLibro },
  'posicion-iva': { titulo: 'Posición de IVA', generar: posicionIva, columnas: columnasPosicion },
  'balance': { titulo: 'Balance de sumas y saldos', generar: balance, columnas: columnasBalance },
  'mayor': { titulo: 'Libro mayor', generar: mayor, columnas: columnasMayor },
  'diario': { titulo: 'Libro diario', generar: (c, q) => diario(c, q), generarCsv: (c, q) => diario(c, q, { paraCsv: true }), columnas: columnasDiario, filasCsv: filasDiario },
  'estados-contables': { titulo: 'Estados contables', generar: estadosContables, columnas: columnasEstados, filasCsv: filasEstados },
  'deuda-clientes': { titulo: 'Deuda de clientes por antigüedad', generar: (c, q) => antiguedad(c, 'cliente', q), columnas: columnasAntiguedad },
  'deuda-proveedores': { titulo: 'Deuda con proveedores por antigüedad', generar: (c, q) => antiguedad(c, 'proveedor', q), columnas: columnasAntiguedad },
  'retenciones': { titulo: 'Retenciones', generar: retenciones, columnas: columnasRetenciones },
  'iva-ventas-detalle': { titulo: 'Planilla IVA ventas: comprobantes', generar: (c, q) => ivaDetalle(c, 'venta', q), columnas: columnasIvaDetalle },
  'iva-ventas-alicuotas': { titulo: 'Planilla IVA ventas: alícuotas', generar: (c, q) => ivaAlicuotas(c, 'venta', q), columnas: columnasIvaAlicuotas },
  'iva-compras-detalle': { titulo: 'Planilla IVA compras: comprobantes', generar: (c, q) => ivaDetalle(c, 'compra', q), columnas: columnasIvaDetalle },
  'iva-compras-alicuotas': { titulo: 'Planilla IVA compras: alícuotas', generar: (c, q) => ivaAlicuotas(c, 'compra', q), columnas: columnasIvaAlicuotas },
  'percepciones': { titulo: 'Percepciones', generar: percepciones, columnas: columnasPercepciones },
};

/** Una planilla abre como fórmula lo que empieza con = + - @; los importes negativos son números y se dejan como están. */
const celda = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function aCsv(clave, r) {
  const inf = INFORMES[clave], filas = inf.filasCsv ? inf.filasCsv(r) : r.filas;
  const cuerpo = [inf.columnas.map(([, t]) => t), ...filas.map((f) => inf.columnas.map(([k]) => f[k]))];
  if (r.totales && !inf.filasCsv && ['libro-iva-ventas', 'libro-iva-compras', 'posicion-iva', 'balance', 'retenciones', 'deuda-clientes', 'deuda-proveedores', 'iva-ventas-detalle', 'iva-ventas-alicuotas', 'iva-compras-detalle', 'iva-compras-alicuotas', 'percepciones'].includes(clave)) {
    const t = inf.columnas.map(([k], i) => (i === 0 ? 'Totales' : r.totales[k] ?? ''));
    cuerpo.push(t);
  }
  const desde = r.desde ?? r.al ?? '', hasta = r.hasta ?? '';
  return { csv: cuerpo.map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n', filas: filas.length, nombre: `${clave}-${desde}${hasta && hasta !== desde ? `_${hasta}` : ''}.csv` };
}

export async function generarInforme(c, clave, q = {}, { csv = false } = {}) {
  const inf = INFORMES[clave];
  if (!inf) throw noEncontrado('El informe');
  return (csv && inf.generarCsv ? inf.generarCsv : inf.generar)(c, q);
}
