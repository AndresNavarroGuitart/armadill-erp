// Prueba de la migración de maestros: carga los datos semilla del dump original en el modelo nuevo (PostgreSQL real)
// y verifica el resultado. Uso: node migracion/probar_migracion.mjs
import { crearBase } from '../modelo/cargar.mjs';
import { leerTablaDump } from './leer_dump.mjs';
import { migrarMaestros, tratamientoIva, tipoDocumento, tipoArticulo, cuitValido } from './migrar.mjs';

const RUTA = process.env.DUMP_ORIGINAL ?? 'C:/administraNET/Bases/estructura_default_adm.sql';
let ok = 0; let mal = 0;
async function prueba(nombre, fn) {
  try { await fn(); ok += 1; console.log(`ok     ${nombre}`); } catch (e) { mal += 1; console.log(`FALLA  ${nombre}\n         ${String(e.message).split('\n')[0]}`); }
}
const igual = (a, b, que) => { if (String(a) !== String(b)) throw new Error(`${que}: esperado ${b}, obtenido ${a}`); };

const { db } = await crearBase();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const uno = async (sql, p = []) => (await q(sql, p))[0];

const estudio = await uno(`insert into estudio (nombre) values ('Estudio') returning id`);
const empresa = await uno(`insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo) values ($1,'30712345671','Empresa migrada',1) returning id`, [estudio.id]);
await q(`insert into empresa_parametro (empresa_id) values ($1)`, [empresa.id]);

const leerDump = (tabla) => leerTablaDump(RUTA, tabla);
let resumen;

await prueba('Funciones de mapeo: alícuotas, documentos, tipos de artículo y CUIT', () => {
  igual(JSON.stringify(tratamientoIva({ Alicuota: 21, nombre_iva: 'IVA General (21 %)' })), '{"trat":"gravado","alicuota":5,"tasa":0.21}', '21 %');
  igual(tratamientoIva({ Alicuota: 0, nombre_iva: 'Exento (0 % )' }).trat, 'exento', 'exento');
  igual(tratamientoIva({ Alicuota: 0, nombre_iva: 'No gravado' }).trat, 'no_gravado', 'no gravado');
  igual(tratamientoIva({ Alicuota: 33, nombre_iva: 'raro' }), 'null', 'alícuota desconocida');
  igual([tipoDocumento('CUIT'), tipoDocumento('DNI'), tipoDocumento('NOID'), tipoDocumento('xx')].join(','), '80,96,99,99', 'documentos');
  igual([tipoArticulo('Articulo'), tipoArticulo('Servicio'), tipoArticulo('Gasto'), tipoArticulo('Bienes de uso'), tipoArticulo('Materia prima')].join(','), 'bien,servicio,gasto,bien_de_uso,bien', 'tipos');
  igual(cuitValido('30712345671'), true, 'CUIT válido'); igual(cuitValido('00000000000'), false, 'CUIT ficticio');
});

await prueba('Migra la semilla del original: clientes, proveedores comerciales, artículos, rubros, depósitos y listas', async () => {
  resumen = await migrarMaestros({ db, empresaId: empresa.id, leer: leerDump });
  igual((await uno(`select count(*)::int n from tercero where es_cliente`)).n, 2, 'clientes');
  igual((await uno(`select count(*)::int n from tercero where es_proveedor`)).n, 1, 'proveedores (solo Proveedor 1)');
  igual((await uno(`select count(*)::int n from articulo`)).n, 3, 'artículos');
  igual((await uno(`select count(*)::int n from rubro where padre_id is null`)).n, 3, 'rubros');
  igual((await uno(`select count(*)::int n from rubro where padre_id is not null`)).n, 4, 'subrubros');
  igual((await uno(`select count(*)::int n from deposito`)).n, 1, 'depósitos');
  igual((await q(`select nombre from lista_precio order by orden`)).map((r) => r.nombre).join(','), 'Contado,Lista', 'listas de precio (las "-" no se migran)');
});
await prueba('Consumidor Final queda con documento 99/0 y condición 5; el cliente con CUIT ficticio queda sin identificación', async () => {
  const cf = await uno(`select * from tercero where razon_social = 'Consumidor Final'`);
  igual([cf.tipo_documento_codigo, cf.nro_documento, cf.condicion_iva_codigo].join('/'), '99/0/5', 'Consumidor Final');
  const c1 = await uno(`select * from tercero where razon_social = 'Cliente 1'`);
  igual([c1.tipo_documento_codigo, c1.nro_documento, c1.condicion_iva_codigo].join('/'), '99/SIN-C2/1', 'Cliente 1');
  igual(c1.condicion_pago_dias, 30, 'días de la condición de venta Cta/Cte 30');
  igual((await uno(`select l.nombre from tercero t join lista_precio l on l.id = t.lista_precio_id where t.id = $1`, [c1.id])).nombre, 'Lista', 'lista de precios del cliente');
  igual((await uno(`select count(*)::int n from tercero_domicilio where tercero_id = $1 and principal`, [c1.id])).n, 1, 'domicilio principal');
});
await prueba('Artículos: alícuotas ARCA, precios netos por lista, costo y código repetido resuelto', async () => {
  const a1 = await uno(`select a.*, r.nombre as rubro from articulo a left join rubro r on r.id = a.rubro_id where a.nombre = 'Articulo 1'`);
  igual([a1.tratamiento_iva_venta, a1.alicuota_venta_codigo, a1.tipo].join('/'), 'gravado/5/bien', 'Articulo 1');
  const precios = await q(`select l.nombre, p.precio_neto from articulo_precio p join lista_precio l on l.id = p.lista_id where p.articulo_id = $1 order by l.orden`, [a1.id]);
  igual(precios.map((p) => `${p.nombre}=${p.precio_neto}`).join(','), 'Contado=120.0000,Lista=130.0000', 'precios netos');
  igual((await uno(`select costo from articulo_costo where articulo_id = $1`, [a1.id])).costo, '100.0000', 'costo');
  const combustibles = await uno(`select tipo, controla_stock, codigo from articulo where nombre = 'Combustibles'`);
  igual([combustibles.tipo, combustibles.controla_stock].join('/'), 'gasto/false', 'Combustibles');
  igual((await uno(`select count(*)::int n from articulo where codigo like '1.1.1%'`)).n, 2, 'el código 1.1.1 repetido quedó distinto');
  igual(combustibles.codigo, '1.1.1-2', 'código desambiguado');
});
await prueba('Paridad: el precio final del original coincide con neto × (1 + IVA) en todos los artículos de la semilla', async () => {
  igual((await uno(`select count(*)::int n from migracion_incidencia where problema like 'precio final%'`)).n, 0, 'discrepancias de precio');
  const ref = await q(`select a.nombre, p.precio_neto, a.alicuota_venta_codigo from articulo a join articulo_precio p on p.articulo_id = a.id join lista_precio l on l.id = p.lista_id where l.orden = 1 and a.nombre = 'Articulo 1'`);
  igual((Number(ref[0].precio_neto) * 1.21).toFixed(2), '145.20', 'el final calculado coincide con el 145,2 que guardaba el original');
});
await prueba('Incidencias: nada se descarta en silencio (CUIT inválido, proveedores omitidos, saldo y retenciones pendientes)', async () => {
  const inc = await q(`select tabla, gravedad, problema from migracion_incidencia`);
  const hay = (t, patron) => inc.some((i) => i.tabla === t && patron.test(i.problema));
  if (!hay('cliente', /inválido o ficticio/)) throw new Error('falta la incidencia del CUIT ficticio del cliente');
  if (!hay('proveedor', /comisionista/)) throw new Error('falta la incidencia del comisionista omitido');
  if (!hay('proveedor', /fila vacía/)) throw new Error('falta la incidencia de la fila vacía');
  if (!hay('proveedor', /saldo inicial/)) throw new Error('falta la incidencia del saldo del proveedor');
  if (!hay('proveedor', /retención/)) throw new Error('falta la incidencia de las categorías de retención');
  if (!hay('articulo', /código de sistema repetido/)) throw new Error('falta la incidencia del código repetido');
  igual(resumen.saldosIniciales.map((s) => `${s.rol}:${s.saldo}`).join(','), 'proveedor:800', 'saldos para el asiento de apertura');
  igual(resumen.omitidos.proveedor, 2, 'proveedores omitidos');
});
await prueba('Es idempotente: repetir la migración no duplica nada', async () => {
  const antes = await uno(`select (select count(*) from tercero)::int t, (select count(*) from articulo)::int a, (select count(*) from rubro)::int r, (select count(*) from articulo_precio)::int p`);
  await migrarMaestros({ db, empresaId: empresa.id, leer: leerDump });
  const despues = await uno(`select (select count(*) from tercero)::int t, (select count(*) from articulo)::int a, (select count(*) from rubro)::int r, (select count(*) from articulo_precio)::int p`);
  igual(JSON.stringify(despues), JSON.stringify(antes), 'cantidades');
});
await prueba('Detecta un precio final del original que no cierra, y una alícuota desconocida', async () => {
  const empresa2 = await uno(`insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo) values ($1,'30987654321','Otra',1) returning id`, [estudio.id]);
  await q(`insert into empresa_parametro (empresa_id) values ($1)`, [empresa2.id]);
  const tablas = {
    iva: [{ ID: 1, Alicuota: 21, nombre_iva: 'IVA 21', anulado: 'No' }],
    cond_venta: [], configuracion: [{ desc_util1: 'Contado', desc_util2: '-', desc_util3: '-', desc_util4: '-', desc_util5: '-' }],
    rubro: [], subrubro: [], deposito: [], cliente: [], proveedor: [],
    articulo: [
      { IDArt: 1, NombreArticulo: 'Mal precio', CodigoArticuloT: 'X1', tipo_art: 'Articulo', Alicuota: 1, AlicuotaC: 1, Moneda: 'Pesos', Discontinuo: 'No', PrecioCosto: 10, Precio1V: 100, Precio1VI: 130 },
      { IDArt: 2, NombreArticulo: 'Mal IVA', CodigoArticuloT: 'X2', tipo_art: 'Articulo', Alicuota: 99, AlicuotaC: 99, Moneda: 'Pesos', Discontinuo: 'No', PrecioCosto: 0 },
    ],
  };
  const r = await migrarMaestros({ db, empresaId: empresa2.id, leer: (t) => tablas[t] ?? [] });
  igual(r.incidencias.aviso, 1, 'avisos (precio)'); igual(r.incidencias.error, 1, 'errores (alícuota desconocida)');
  igual((await uno(`select count(*)::int n from articulo where empresa_id = $1`, [empresa2.id])).n, 1, 'solo se migra el artículo válido');
  igual(r.omitidos.articulo, 1, 'artículo omitido por alícuota desconocida');
});

console.log(`\n${ok} pruebas correctas, ${mal} con falla`);
process.exit(mal ? 1 : 0);
