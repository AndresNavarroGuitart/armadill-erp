// Datos de DESARROLLO Y PRUEBA: un estudio con usuarios de distintos roles, tres empresas (una responsable inscripta, una monotributista
// y una de OTRO estudio), plan de cuentas con sus cuentas automáticas, ejercicio, períodos, punto de venta, depósito y listas de precios.
// Todo inventado. Se carga con el rol de dueño de la base (saltea RLS), como lo haría el alta de un estudio.
import { cuitConDigito } from './cuit.mjs';

const CUENTAS = [
  ['1.1.1', 'Caja', 'activo'], ['1.1.2', 'Valores a depositar', 'activo'], ['1.1.3', 'Deudores por ventas', 'activo'], ['1.1.5', 'IVA crédito fiscal', 'activo'], ['1.1.6', 'Percepciones sufridas', 'activo'],
  ['1.1.7', 'Retenciones sufridas', 'activo'], ['2.1.1', 'Proveedores', 'pasivo'], ['2.1.4', 'IVA débito fiscal', 'pasivo'], ['2.1.5', 'Percepciones a depositar', 'pasivo'], ['2.1.6', 'Retenciones a depositar', 'pasivo'],
  ['4.1.1', 'Ventas', 'ingreso'], ['4.1.9', 'Descuentos otorgados', 'egreso'], ['5.1.1', 'Compras', 'egreso'], ['5.1.9', 'Descuentos obtenidos', 'ingreso'],
];
const MAPA = { ventas: '4.1.1', compras: '5.1.1', iva_debito: '2.1.4', iva_credito: '1.1.5', deudores: '1.1.3', proveedores: '2.1.1', percepcion_iva_sufrida: '1.1.6', percepcion_iibb_sufrida: '1.1.6', percepcion_ganancias_sufrida: '1.1.6',
  otros_tributos_compras: '5.1.1', percepcion_iva_practicada: '2.1.5', percepcion_iibb_practicada: '2.1.5', otros_tributos_ventas: '2.1.5', retencion_iva_sufrida: '1.1.7', retencion_ganancias_sufrida: '1.1.7', retencion_iibb_sufrida: '1.1.7',
  retencion_suss_sufrida: '1.1.7', retencion_iva_practicada: '2.1.6', retencion_ganancias_practicada: '2.1.6', retencion_iibb_practicada: '2.1.6', retencion_suss_practicada: '2.1.6', descuentos_otorgados: '4.1.9', descuentos_obtenidos: '5.1.9', valores_a_depositar: '1.1.2' };

export async function sembrarDemo(db, { anio = new Date().getFullYear() } = {}) {
  const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const e1 = await uno(`insert into estudio (nombre) values ('Estudio Contable Demo') returning id`), e2 = await uno(`insert into estudio (nombre) values ('Otro Estudio') returning id`);
  await db.query('select fn_roles_base($1), fn_roles_base($2)', [e1.id, e2.id]);
  const rol = async (estudio, nombre) => (await uno('select id from rol where estudio_id = $1 and nombre = $2', [estudio, nombre])).id;
  const usr = (estudio, email, nombre, sub = null) => uno('insert into usuario (estudio_id, email, nombre, auth_sub) values ($1,$2,$3,$4) returning id', [estudio, email, nombre, sub]).then((u) => ({ id: u.id, email, sub }));
  const usuarios = { admin: await usr(e1.id, 'admin@estudio.test', 'Andrés (administrador)', 'sub-admin'), auxiliar: await usr(e1.id, 'auxiliar@estudio.test', 'Matías (auxiliar)'), consulta: await usr(e1.id, 'consulta@estudio.test', 'Sofía (consulta)', 'sub-consulta'),
    baja: await usr(e1.id, 'baja@estudio.test', 'Persona dada de baja', 'sub-baja'), otro: await usr(e2.id, 'otro@otro.test', 'Persona de otro estudio', 'sub-otro') };
  await db.query('update usuario set activo = false where id = $1', [usuarios.baja.id]);

  const empresas = {};
  for (const [clave, estudio, cuit, nombre, cond, interno] of [['ri', e1.id, cuitConDigito('3071234567'), 'Comercial Andina SA', 1, true], ['mt', e1.id, cuitConDigito('2028765432'), 'Panadería La Espiga', 6, true], ['ajena', e2.id, cuitConDigito('3055123456'), 'Empresa Ajena SRL', 1, true]]) {
    const e = await uno('insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo, inicio_actividades) values ($1,$2,$3,$4,$5) returning id', [estudio, cuit, nombre, cond, `${anio - 5}-01-01`]);
    await db.query('insert into empresa_parametro (empresa_id, asientos_automaticos) values ($1, true)', [e.id]);
    const cuentas = {};
    for (const [codigo, n, tipo] of CUENTAS) cuentas[codigo] = (await uno('insert into plan_cuenta (empresa_id, codigo, nombre, tipo) values ($1,$2,$3,$4) returning id', [e.id, codigo, n, tipo])).id;
    for (const [concepto, codigo] of Object.entries(MAPA)) await db.query('insert into cuenta_automatica (empresa_id, concepto, cuenta_id) values ($1,$2,$3)', [e.id, concepto, cuentas[codigo]]);
    await db.query('insert into ejercicio (empresa_id, desde, hasta) values ($1,$2,$3)', [e.id, `${anio}-01-01`, `${anio}-12-31`]);
    await db.query(`insert into periodo (empresa_id, desde, hasta) select $1, d::date, (d + interval '1 month' - interval '1 day')::date from generate_series($2::date, $3::date, interval '1 month') d`, [e.id, `${anio}-01-01`, `${anio}-12-01`]);
    await db.query(`insert into punto_venta (empresa_id, numero, sistema) values ($1, 1, 'interno')`, [e.id]);
    const deposito = await uno(`insert into deposito (empresa_id, nombre) values ($1,'Depósito central') returning id`, [e.id]);
    const general = await uno(`insert into lista_precio (empresa_id, nombre, orden) values ($1,'General',1) returning id`, [e.id]);
    empresas[clave] = { id: e.id, estudio, cuit, nombre, condicion: cond, deposito: deposito.id, listaGeneral: general.id, cuentas };
  }
  await db.query(`insert into punto_venta (empresa_id, numero, sistema) values ($1, 2, 'ws_factura')`, [empresas.ri.id]);          // uno electrónico, para probar que todavía no se puede usar
  const vinculo = (u, e, r) => db.query('insert into usuario_empresa (usuario_id, empresa_id, rol_id) values ($1,$2,$3)', [u.id, e.id, r]);
  await vinculo(usuarios.admin, empresas.ri, await rol(e1.id, 'Administrador')); await vinculo(usuarios.admin, empresas.mt, await rol(e1.id, 'Administrador'));
  await vinculo(usuarios.auxiliar, empresas.ri, await rol(e1.id, 'Auxiliar')); await vinculo(usuarios.consulta, empresas.ri, await rol(e1.id, 'Consulta'));
  await vinculo(usuarios.baja, empresas.ri, await rol(e1.id, 'Administrador')); await vinculo(usuarios.otro, empresas.ajena, await rol(e2.id, 'Administrador'));
  return { estudios: { e1: e1.id, e2: e2.id }, usuarios, empresas, anio };
}
