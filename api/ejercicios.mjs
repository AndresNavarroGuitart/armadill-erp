// Ejercicios contables y su cierre. El cierre lo hace la base (fn_cerrar_ejercicio): asiento que salda ingresos y egresos contra "Resultados no asignados",
// períodos cerrados, ejercicio marcado y ejercicio siguiente creado si faltaba. Acá se listan los ejercicios, se muestra una previa con todo lo que va a pasar
// (y lo que lo impide) y se deja constancia en la trazabilidad. El resultado del año se calcula SIN el asiento de cierre, para que un ejercicio cerrado siga mostrando
// lo que ganó o perdió.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { dec, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const fechaAR = (iso) => iso.split('-').reverse().join('/');

const SELECT = `select e.id, e.desde::text as desde, e.hasta::text as hasta, e.cerrado, e.cerrado_en, u.nombre as cerrado_por, e.asiento_cierre_id,
    (select count(*)::int from periodo p where p.empresa_id = e.empresa_id and not p.anulado and p.desde >= e.desde and p.hasta <= e.hasta and p.estado = 'abierto') as periodos_abiertos,
    (select count(*)::int from periodo p where p.empresa_id = e.empresa_id and not p.anulado and p.desde >= e.desde and p.hasta <= e.hasta) as periodos,
    (select count(*)::int from asiento a where a.empresa_id = e.empresa_id and a.estado = 'contabilizado' and a.fecha between e.desde and e.hasta and a.origen_tipo is distinct from 'cierre') as asientos,
    (select count(*)::int from asiento a where a.empresa_id = e.empresa_id and a.estado = 'borrador' and a.fecha between e.desde and e.hasta) as borradores,
    coalesce((select sum(l.haber - l.debe) from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado'
       join plan_cuenta pc on pc.id = l.cuenta_id where a.empresa_id = e.empresa_id and a.fecha between e.desde and e.hasta and a.origen_tipo is distinct from 'cierre' and pc.tipo in ('ingreso', 'egreso')), 0)::text as resultado
  from ejercicio e left join usuario u on u.id = e.cerrado_por`;

const normal = (f) => ({ ...f, resultado: texto(dec(f.resultado)) });                       // el resultado siempre con dos decimales
export async function listarEjercicios(c) { return { datos: (await c.consultar(`${SELECT} order by e.desde desc`)).map(normal) }; }
async function leer(c, id) { const f = await c.uno(`${SELECT} where e.id = $1`, [id]); if (!f) throw noEncontrado('El ejercicio'); return normal(f); }

/** Todo lo que va a pasar al cerrar y lo que lo impide, para mostrarlo antes de confirmar. */
export async function previaCierre(c, id) {
  const e = await leer(c, id), bloqueos = [], avisos = [];
  const totales = await c.consultar(`select pc.tipo, coalesce(sum(case when pc.tipo = 'ingreso' then l.haber - l.debe else l.debe - l.haber end), 0)::text as total, count(distinct pc.id)::int as cuentas
    from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado' join plan_cuenta pc on pc.id = l.cuenta_id
    where a.fecha between $1 and $2 and a.origen_tipo is distinct from 'cierre' and pc.tipo in ('ingreso', 'egreso') group by pc.tipo`, [e.desde, e.hasta]);
  const t = (tipo) => totales.find((x) => x.tipo === tipo) ?? { total: '0', cuentas: 0 };
  if (e.cerrado) bloqueos.push('El ejercicio ya está cerrado.');
  if (e.hasta > hoyISO()) bloqueos.push(`El ejercicio termina el ${fechaAR(e.hasta)}: no se puede cerrar antes de esa fecha.`);
  const anterior = await c.uno('select desde::text d from ejercicio where hasta < $1 and not cerrado order by desde limit 1', [e.desde]);
  if (anterior) bloqueos.push(`Primero hay que cerrar el ejercicio anterior (el que empieza el ${fechaAR(anterior.d)}).`);
  if (e.borradores > 0) bloqueos.push(`Hay ${e.borradores} asiento${e.borradores === 1 ? '' : 's'} en borrador dentro del ejercicio: hay que contabilizarlos o descartarlos.`);
  if (!(await c.uno(`select 1 x from cuenta_automatica where concepto = 'resultados_no_asignados'`))) bloqueos.push('La empresa no tiene configurada la cuenta Resultados no asignados.');
  if (e.periodos_abiertos > 0) avisos.push(`Se cerrarán ${e.periodos_abiertos} período${e.periodos_abiertos === 1 ? '' : 's'} que siguen abiertos.`);
  const siguiente = await c.uno('select 1 x from ejercicio where desde = $1::date + 1', [e.hasta]);
  if (!siguiente) avisos.push(`Se va a crear el ejercicio siguiente (desde el ${fechaAR(new Date(new Date(e.hasta + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10))}) con sus períodos.`);
  const resultado = texto(dec(t('ingreso').total) - dec(t('egreso').total));
  if (t('ingreso').cuentas + t('egreso').cuentas === 0) avisos.push('El ejercicio no tiene ingresos ni egresos: se cierra sin asiento.');
  return {
    ejercicio: e, ingresos: texto(dec(t('ingreso').total)), egresos: texto(dec(t('egreso').total)), cuentas_a_saldar: t('ingreso').cuentas + t('egreso').cuentas,
    resultado, destino: dec(resultado) >= 0n ? 'Ganancia: va al haber de Resultados no asignados.' : 'Pérdida: va al debe de Resultados no asignados.', bloqueos, avisos, puede_cerrar: bloqueos.length === 0,
  };
}

export async function cerrarEjercicio(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ confirmar: { tipo: 'booleano', requerido: true } }, cuerpo);
  if (d.confirmar !== true) throw invalido({ confirmar: 'tiene que confirmarse' });
  const previa = await previaCierre(c, id);
  if (!previa.puede_cerrar) throw new ErrorApi(422, 'no_se_puede_cerrar', previa.bloqueos.join(' '));
  const asiento = (await c.uno('select fn_cerrar_ejercicio($1) a', [id])).a;
  const ejercicio = await leer(c, id), rotulo = `${fechaAR(ejercicio.desde)} al ${fechaAR(ejercicio.hasta)}`;
  return { ejercicio, asiento_id: asiento, rotulo, resultado: previa.resultado, avisos: previa.avisos };
}

export async function reabrirEjercicio(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const antes = await leer(c, id);
  if (!antes.cerrado) throw new ErrorApi(422, 'no_se_puede_reabrir', 'El ejercicio no está cerrado.');
  await c.consultar('select fn_reabrir_ejercicio($1)', [id]);
  return { ejercicio: await leer(c, id), rotulo: `${fechaAR(antes.desde)} al ${fechaAR(antes.hasta)}`, motivo: d.motivo };
}

/* ====================== alta y baja de un ejercicio ====================== */
const DIAS = 864e5;
export async function crearEjercicio(c, ctx, cuerpo) {
  const { valor: d } = validar({ desde: { tipo: 'fecha', requerido: true }, hasta: { tipo: 'fecha', requerido: true } }, cuerpo), errores = {};
  const dias = (new Date(d.hasta + 'T12:00:00Z') - new Date(d.desde + 'T12:00:00Z')) / DIAS;
  if (d.desde >= d.hasta) errores.hasta = 'tiene que ser posterior al inicio';
  else if (dias > 366) errores.hasta = 'un ejercicio no dura más de un año';
  if (d.desde < '2000-01-01') errores.desde = 'es demasiado antigua';
  const pisa = !errores.hasta && !errores.desde && await c.uno(`select desde::text d, hasta::text h from ejercicio where daterange(desde, hasta, '[]') && daterange($1::date, $2::date, '[]') order by desde limit 1`, [d.desde, d.hasta]);
  if (pisa) throw new ErrorApi(409, 'se_superpone', `Se superpone con el ejercicio del ${fechaAR(pisa.d)} al ${fechaAR(pisa.h)}.`);
  if (Object.keys(errores).length) throw invalido(errores);
  const id = (await c.uno('select fn_crear_ejercicio($1, $2, $3) id', [ctx.empresaId, d.desde, d.hasta])).id;
  return { ejercicio: await leer(c, id), rotulo: `${fechaAR(d.desde)} al ${fechaAR(d.hasta)}` };
}

/* Solo se borra un ejercicio vacío y abierto (el que se cargó por error): sin asientos, comprobantes ni pagos con fecha adentro. */
export async function eliminarEjercicio(c, ctx, id) {
  const e = await leer(c, id), rotulo = `${fechaAR(e.desde)} al ${fechaAR(e.hasta)}`;
  if (e.cerrado) throw new ErrorApi(422, 'no_se_puede_borrar', 'El ejercicio está cerrado: hay que reabrirlo antes.');
  const usos = (await c.uno(`select (select count(*) from asiento where fecha between $1 and $2)::int as asientos, (select count(*) from comprobante where fecha between $1 and $2)::int as comprobantes, (select count(*) from pago where fecha between $1 and $2)::int as pagos`, [e.desde, e.hasta]));
  const con = [['asiento', 'asientos', usos.asientos], ['comprobante', 'comprobantes', usos.comprobantes], ['cobro o pago', 'cobros o pagos', usos.pagos]].filter(([, , n]) => n > 0).map(([uno, varios, n]) => n + ' ' + (n === 1 ? uno : varios));
  if (con.length) throw new ErrorApi(422, 'no_se_puede_borrar', `El ejercicio tiene movimientos (${con.join(', ')}): no se borra.`);
  await c.consultar('delete from periodo where empresa_id = $1 and desde >= $2 and hasta <= $3', [ctx.empresaId, e.desde, e.hasta]);
  await c.consultar('delete from ejercicio where id = $1', [id]);
  return { rotulo };
}
