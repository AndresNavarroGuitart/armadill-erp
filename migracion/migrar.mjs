// Migración de maestros desde el sistema original al modelo nuevo.
//   leer(tabla) -> filas del origen (objetos columna: valor). Para pruebas: leerTablaDump del dump; para la base real:
//   una conexión MySQL de SOLO LECTURA con la misma forma (no hace falta cambiar nada más).
// Principios: idempotente (migracion_mapa), nada se descarta en silencio (migracion_incidencia) y los saldos
// iniciales NO se cargan acá: se devuelven para generar el asiento de apertura y los comprobantes de saldo.

const CONDICION_IVA = { 1: 1, 2: 6, 3: 4, 4: 5, 5: 9, 6: 1, 7: 1, 8: 15 };   // IDIva del original -> código ARCA
const quitarAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function cuitValido(c) {
  if (!/^\d{11}$/.test(c)) return false;
  // el 00000000000 cierra el dígito verificador pero no existe: solo valen los prefijos que asigna ARCA
  if (!['20', '23', '24', '25', '26', '27', '30', '33', '34', '50', '51', '55'].includes(c.slice(0, 2))) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...c.slice(0, 10)].reduce((a, d, i) => a + Number(d) * pesos[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0; else if (dv === 10) dv = 9;
  return dv === Number(c[10]);
}

/** Alícuota o tratamiento a partir de una fila de la tabla `iva` del original (no se usa su cod_afip interno). */
export function tratamientoIva(fila) {
  const tasa = Number(fila.Alicuota);
  const nombre = quitarAcentos(fila.nombre_iva);
  if (tasa === 0 && nombre.includes('exento')) return { trat: 'exento', alicuota: null, tasa: 0 };
  if (tasa === 0 && nombre.includes('no gravado')) return { trat: 'no_gravado', alicuota: null, tasa: 0 };
  const codigo = { 21: 5, 10.5: 4, 27: 6, 5: 8, 2.5: 9, 0: 3 }[tasa];
  return codigo ? { trat: 'gravado', alicuota: codigo, tasa: tasa / 100 } : null;
}

export function tipoDocumento(tipoDoc) {
  return { CUIT: 80, CUIL: 86, DNI: 96, NOID: 99 }[String(tipoDoc ?? '').toUpperCase()] ?? 99;
}

export function tipoArticulo(texto) {
  const t = quitarAcentos(texto);
  if (t.startsWith('servicio')) return 'servicio';
  if (t.startsWith('gasto')) return 'gasto';
  if (t.startsWith('bien')) return 'bien_de_uso';
  return 'bien';
}

const redondear2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export async function migrarMaestros({ db, empresaId, leer, vigenteDesde = '2026-01-01' }) {
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const uno = async (sql, p = []) => (await q(sql, p))[0];
  const resumen = { migrados: {}, omitidos: {}, saldosIniciales: [], incidencias: { info: 0, aviso: 0, error: 0 } };
  const contar = (grupo, tabla) => { resumen[grupo][tabla] = (resumen[grupo][tabla] ?? 0) + 1; };

  async function incidencia(tabla, legacy, gravedad, problema, valor = null) {
    await q(`insert into migracion_incidencia (empresa_id, tabla, legacy_id, gravedad, problema, valor) values ($1,$2,$3,$4,$5,$6)`,
      [empresaId, tabla, legacy == null ? null : String(legacy), gravedad, problema, valor == null ? null : String(valor)]);
    resumen.incidencias[gravedad] += 1;
  }
  const buscar = async (tabla, legacy) => (await uno(`select nuevo_id from migracion_mapa where empresa_id=$1 and tabla=$2 and legacy_id=$3`, [empresaId, tabla, String(legacy)]))?.nuevo_id ?? null;
  const anotar = (tabla, legacy, nuevo) => q(`insert into migracion_mapa (empresa_id, tabla, legacy_id, nuevo_id) values ($1,$2,$3,$4) on conflict do nothing`, [empresaId, tabla, String(legacy), nuevo]);

  await db.exec('begin');
  try {
    // --- Catálogos de referencia (en memoria) ---
    const ivaPorId = new Map();
    for (const f of leer('iva')) {
      const t = tratamientoIva(f);
      if (!t) await incidencia('iva', f.ID, 'error', 'alícuota de IVA sin equivalente en ARCA', f.Alicuota);
      else ivaPorId.set(f.ID, t);
    }
    const diasPorCondVenta = new Map(leer('cond_venta').map((f) => [f.Codigo, Number(f.Dias ?? 0)]));
    const config = leer('configuracion')[0] ?? {};

    // --- Listas de precio: posiciones 1..5; las llamadas "-" no se usan ---
    const listaPorPosicion = {};
    for (let i = 1; i <= 5; i += 1) {
      const nombre = config[`desc_util${i}`];
      if (!nombre || nombre === '-') continue;
      let id = await buscar('lista_precio', i);
      if (!id) {
        id = (await uno(`insert into lista_precio (empresa_id, nombre, orden) values ($1,$2,$3) returning id`, [empresaId, nombre, i])).id;
        await anotar('lista_precio', i, id); contar('migrados', 'lista_precio');
      }
      listaPorPosicion[i] = id;
    }

    // --- Rubros y subrubros (jerarquía de dos niveles) ---
    for (const f of leer('rubro')) {
      if (await buscar('rubro', f.CodigoRubro)) continue;
      const id = (await uno(`insert into rubro (empresa_id, nombre) values ($1,$2) returning id`, [empresaId, f.NombreRubro])).id;
      await anotar('rubro', f.CodigoRubro, id); contar('migrados', 'rubro');
    }
    for (const f of leer('subrubro')) {
      if (await buscar('subrubro', f.IDSubRubro)) continue;
      const padre = await buscar('rubro', f.CodigoRubro);
      if (!padre) { await incidencia('subrubro', f.IDSubRubro, 'aviso', 'subrubro sin rubro padre migrado; se omite', f.NombreSubRubro); contar('omitidos', 'subrubro'); continue; }
      const id = (await uno(`insert into rubro (empresa_id, nombre, padre_id) values ($1,$2,$3) returning id`, [empresaId, f.NombreSubRubro, padre])).id;
      await anotar('subrubro', f.IDSubRubro, id); contar('migrados', 'subrubro');
    }

    // --- Depósitos ---
    for (const f of leer('deposito')) {
      if (await buscar('deposito', f.CodDeposito)) continue;
      const id = (await uno(`insert into deposito (empresa_id, nombre, activo) values ($1,$2,$3) returning id`, [empresaId, f.NombreDeposito, f.anulado !== 'Si'])).id;
      await anotar('deposito', f.CodDeposito, id); contar('migrados', 'deposito');
    }

    // --- Identificación fiscal común a clientes y proveedores ---
    function identificacion(prefijo, f, doc, tipoDoc, esConsumidorFinal) {
      const digitos = String(doc ?? '').replace(/\D/g, '');
      let codigo = tipoDocumento(tipoDoc);
      if (codigo === 99) return { codigo: 99, nro: esConsumidorFinal ? '0' : `SIN-${prefijo}${f.Codigo}`, problema: esConsumidorFinal ? null : 'sin identificación fiscal' };
      if (codigo === 80 || codigo === 86) {
        if (!cuitValido(digitos)) return { codigo: 99, nro: `SIN-${prefijo}${f.Codigo}`, problema: 'CUIT/CUIL inválido o ficticio; se migra sin identificación', valor: doc };
        return { codigo, nro: digitos };
      }
      return digitos ? { codigo, nro: digitos } : { codigo: 99, nro: `SIN-${prefijo}${f.Codigo}`, problema: 'documento vacío', valor: doc };
    }
    function condicion(f, tabla) {
      const c = CONDICION_IVA[f.IDIva];
      if (c == null) return { codigo: 7, problema: 'condición de IVA ausente o desconocida; se asigna "Sujeto no categorizado"', valor: f.IDIva };
      if (f.IDIva === 6 || f.IDIva === 7) return { codigo: c, info: 'se pierde la distinción "Responsable Inscripto M / CBU"' };
      return { codigo: c };
    }

    // --- Clientes ---
    for (const f of leer('cliente')) {
      if (await buscar('cliente', f.Codigo)) continue;
      const esCF = f.tipo_doc === 'NOID' && quitarAcentos(f.nombre_cliente).startsWith('consumidor final');
      const idn = identificacion('C', f, f.CUIT, f.tipo_doc, esCF);
      const cond = condicion(f, 'cliente');
      const pos = Number(String(f.ListaPrecio ?? '').match(/(\d)\s*$/)?.[1]);
      const id = (await uno(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, nombre_fantasia, condicion_iva_codigo,
          es_cliente, activo, email, telefono, condicion_pago_dias, limite_credito, lista_precio_id)
        values ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12) returning id`,
        [empresaId, idn.codigo, idn.nro, f.nombre_cliente, f.nombre_fantasia, cond.codigo, f.Estado === 'Activo', f.Email, f.telefono,
         diasPorCondVenta.get(f.id_cv) ?? 0, Number(f.Credito ?? 0), listaPorPosicion[pos] ?? null])).id;
      await anotar('cliente', f.Codigo, id); contar('migrados', 'cliente');
      if (f.Calle && f.Calle !== '-') {
        await q(`insert into tercero_domicilio (empresa_id, tercero_id, tipo, calle, numero, piso_dpto, principal) values ($1,$2,'fiscal',$3,$4,$5,true)`,
          [empresaId, id, f.Calle, f.NroCalle == null ? null : String(f.NroCalle), f.Dpto]);
      }
      if (idn.problema) await incidencia('cliente', f.Codigo, 'aviso', idn.problema, idn.valor ?? f.CUIT);
      if (cond.problema) await incidencia('cliente', f.Codigo, 'aviso', cond.problema, cond.valor);
      if (cond.info) await incidencia('cliente', f.Codigo, 'info', cond.info);
      if (Number(f.saldo ?? 0) !== 0) {
        resumen.saldosIniciales.push({ rol: 'cliente', legacy: f.Codigo, tercero_id: id, saldo: Number(f.saldo) });
        await incidencia('cliente', f.Codigo, 'info', 'tiene saldo: pendiente de cargar como saldo inicial', f.saldo);
      }
    }

    // --- Proveedores: la tabla del original mezcla comisionistas y filas vacías con proveedores reales ---
    for (const f of leer('proveedor')) {
      if (await buscar('proveedor', f.Codigo)) continue;
      const nombre = String(f.Nombre ?? '').trim();
      if (f.Tipo === 'Comisionista' || !nombre) {
        await incidencia('proveedor', f.Codigo, 'info', f.Tipo === 'Comisionista' ? 'comisionista / viajante: no es un proveedor comercial; se omite' : 'fila vacía; se omite', nombre || null);
        contar('omitidos', 'proveedor'); continue;
      }
      const idn = identificacion('P', f, f.CUIT, 'CUIT', false);
      const cond = condicion(f, 'proveedor');
      const id = (await uno(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo,
          es_proveedor, activo, email, telefono, nro_iibb, limite_credito)
        values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10) returning id`,
        [empresaId, idn.codigo, idn.nro, nombre, cond.codigo, f.estado === 'Activo', f.Email, f.TelefonoTrabajo ?? f.TelefonoParticular, f.NroIngBrutos, Number(f.credito ?? 0)])).id;
      await anotar('proveedor', f.Codigo, id); contar('migrados', 'proveedor');
      if (f.Calle) {
        await q(`insert into tercero_domicilio (empresa_id, tercero_id, tipo, calle, numero, piso_dpto, principal) values ($1,$2,'fiscal',$3,$4,$5,true)`,
          [empresaId, id, f.Calle, f.NroCalle == null ? null : String(f.NroCalle), f.Dpto]);
      }
      if (idn.problema) await incidencia('proveedor', f.Codigo, 'aviso', idn.problema, idn.valor ?? f.CUIT);
      if (cond.problema) await incidencia('proveedor', f.Codigo, 'aviso', cond.problema, cond.valor);
      if (f.CodCatRet || f.CodCatRetG || f.cod_ret_iva) await incidencia('proveedor', f.Codigo, 'info', 'categorías de retención del original: pendientes de convertir a regímenes', `IIBB ${f.CodCatRet} / Ganancias ${f.CodCatRetG} / IVA ${f.cod_ret_iva}`);
      if (Number(f.saldo ?? 0) !== 0) {
        resumen.saldosIniciales.push({ rol: 'proveedor', legacy: f.Codigo, tercero_id: id, saldo: Number(f.saldo) });
        await incidencia('proveedor', f.Codigo, 'info', 'tiene saldo: pendiente de cargar como saldo inicial', f.saldo);
      }
    }

    // --- Artículos, costos y precios (solo el neto: el final se calcula) ---
    const codigosUsados = new Set((await q(`select codigo from articulo where empresa_id = $1`, [empresaId])).map((r) => r.codigo));
    for (const a of leer('articulo')) {
      if (await buscar('articulo', a.IDArt)) continue;
      const venta = ivaPorId.get(a.Alicuota); const compra = ivaPorId.get(a.AlicuotaC);
      if (!venta || !compra) { await incidencia('articulo', a.IDArt, 'error', 'artículo con alícuota de IVA desconocida; no se migra', `venta ${a.Alicuota} / compra ${a.AlicuotaC}`); contar('omitidos', 'articulo'); continue; }
      let codigo = String(a.CodigoArticuloT ?? a.IDArt);
      if (codigosUsados.has(codigo)) {
        await incidencia('articulo', a.IDArt, 'aviso', 'código de sistema repetido en el original; se le agrega el id', codigo);
        codigo = `${codigo}-${a.IDArt}`;
      }
      codigosUsados.add(codigo);
      const tipo = tipoArticulo(a.tipo_art);
      const rubro = (await buscar('subrubro', a.IDSubRubro)) ?? (await buscar('rubro', a.CodigoRubro));
      const moneda = quitarAcentos(a.Moneda).startsWith('dolar') ? 'DOL' : 'PES';
      const id = (await uno(`insert into articulo (empresa_id, codigo, nombre, tipo, rubro_id, moneda, tratamiento_iva_venta, alicuota_venta_codigo,
          tratamiento_iva_compra, alicuota_compra_codigo, controla_stock, activo)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [empresaId, codigo, a.NombreArticulo, tipo, rubro, moneda, venta.trat, venta.alicuota, compra.trat, compra.alicuota, tipo === 'bien' || tipo === 'bien_de_uso', a.Discontinuo !== 'Si'])).id;
      await anotar('articulo', a.IDArt, id); contar('migrados', 'articulo');
      if (Number(a.PrecioCosto) > 0) {
        await q(`insert into articulo_costo (empresa_id, articulo_id, fecha, costo, moneda, origen) values ($1,$2,$3,$4,$5,'manual')`,
          [empresaId, id, vigenteDesde, Number(a.PrecioCosto).toFixed(4), moneda]);
      }
      for (const [pos, lista] of Object.entries(listaPorPosicion)) {
        const neto = Number(a[`Precio${pos}V`] ?? 0);
        await q(`insert into articulo_precio (empresa_id, articulo_id, lista_id, vigente_desde, precio_neto) values ($1,$2,$3,$4,$5)`,
          [empresaId, id, lista, vigenteDesde, neto.toFixed(4)]);
        // paridad: el final con IVA que guardaba el original debe coincidir con neto × (1 + alícuota)
        const finalOriginal = Number(a[`Precio${pos}VI`] ?? 0);
        const finalCalculado = redondear2(neto * (1 + venta.tasa));
        if (Math.abs(finalOriginal - finalCalculado) > 0.01) {
          await incidencia('articulo', a.IDArt, 'aviso', `precio final de la lista ${pos} no coincide con neto × (1 + IVA)`, `original ${finalOriginal} / calculado ${finalCalculado}`);
        }
      }
    }
    await db.exec('commit');
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
  return resumen;
}
