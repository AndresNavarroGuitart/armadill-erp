// Datos de DESARROLLO Y PRUEBA: un estudio con usuarios de distintos roles, tres empresas (una responsable inscripta, una monotributista
// y una de OTRO estudio), cada una con lo que le da fn_provisionar_empresa (plan de cuentas, ejercicio, períodos, punto de venta, depósito, lista).
// Todo inventado. Se carga con el rol de dueño de la base (saltea RLS), como lo haría el alta de un estudio.
import { cuitConDigito } from './cuit.mjs';

export async function sembrarDemo(db, { anio = new Date().getFullYear() } = {}) {
  const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const e1 = await uno(`insert into estudio (nombre) values ('Estudio Contable Demo') returning id`), e2 = await uno(`insert into estudio (nombre) values ('Otro Estudio') returning id`);
  await db.query('select fn_roles_base($1), fn_roles_base($2)', [e1.id, e2.id]);
  const rol = async (estudio, nombre) => (await uno('select id from rol where estudio_id = $1 and nombre = $2', [estudio, nombre])).id;
  const usr = (estudio, email, nombre, sub = null, admin = false) => uno('insert into usuario (estudio_id, email, nombre, auth_sub, admin_estudio) values ($1,$2,$3,$4,$5) returning id', [estudio, email, nombre, sub, admin]).then((u) => ({ id: u.id, email, sub }));
  const usuarios = { admin: await usr(e1.id, 'admin@estudio.test', 'Andrés (administrador)', 'sub-admin', true), auxiliar: await usr(e1.id, 'auxiliar@estudio.test', 'Matías (auxiliar)'), consulta: await usr(e1.id, 'consulta@estudio.test', 'Sofía (consulta)', 'sub-consulta'),
    baja: await usr(e1.id, 'baja@estudio.test', 'Persona dada de baja', 'sub-baja'), otro: await usr(e2.id, 'otro@otro.test', 'Persona de otro estudio', 'sub-otro', true) };
  await db.query('update usuario set activo = false where id = $1', [usuarios.baja.id]);

  const empresas = {};
  for (const [clave, estudio, cuit, nombre, cond, interno] of [['ri', e1.id, cuitConDigito('3071234567'), 'Comercial Andina SA', 1, true], ['mt', e1.id, cuitConDigito('2028765432'), 'Panadería La Espiga', 6, true], ['ajena', e2.id, cuitConDigito('3055123456'), 'Empresa Ajena SRL', 1, true]]) {
    const e = await uno('insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo, inicio_actividades) values ($1,$2,$3,$4,$5) returning id', [estudio, cuit, nombre, cond, `${anio - 5}-01-01`]);
    await db.query('select fn_provisionar_empresa($1, $2)', [e.id, anio]);                        // plan de cuentas, ejercicio, períodos, punto de venta 1, depósito y lista General
    const cuentas = Object.fromEntries((await db.query('select codigo, id from plan_cuenta where empresa_id = $1', [e.id])).rows.map((f) => [f.codigo, f.id]));
    const deposito = await uno('select id from deposito where empresa_id = $1', [e.id]), general = await uno('select id from lista_precio where empresa_id = $1', [e.id]);
    empresas[clave] = { id: e.id, estudio, cuit, nombre, condicion: cond, deposito: deposito.id, listaGeneral: general.id, cuentas };
  }
  await db.query(`insert into punto_venta (empresa_id, numero, sistema) values ($1, 2, 'ws_factura')`, [empresas.ri.id]);          // uno electrónico, para probar que todavía no se puede usar
  const vinculo = (u, e, r) => db.query('insert into usuario_empresa (usuario_id, empresa_id, rol_id) values ($1,$2,$3)', [u.id, e.id, r]);
  await vinculo(usuarios.admin, empresas.ri, await rol(e1.id, 'Administrador')); await vinculo(usuarios.admin, empresas.mt, await rol(e1.id, 'Administrador'));
  await vinculo(usuarios.auxiliar, empresas.ri, await rol(e1.id, 'Auxiliar')); await vinculo(usuarios.consulta, empresas.ri, await rol(e1.id, 'Consulta'));
  await vinculo(usuarios.baja, empresas.ri, await rol(e1.id, 'Administrador')); await vinculo(usuarios.otro, empresas.ajena, await rol(e2.id, 'Administrador'));
  return { estudios: { e1: e1.id, e2: e2.id }, usuarios, empresas, anio };
}
