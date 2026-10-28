// Lee las filas de un dump de MySQL (mysqldump / HeidiSQL) sin necesitar un servidor: extrae los INSERT de una tabla
// y devuelve objetos {columna: valor}. Sirve para probar la migración con los datos semilla del original y, mismo
// contrato, una conexión MySQL de solo lectura puede reemplazarlo cuando haya credenciales (ver leerTabla en migrar.mjs).
import { readFileSync } from 'node:fs';

/** Convierte el texto de un valor SQL a JS: NULL, número o cadena (con escapes de MySQL). */
function valor(texto, esCadena) {
  if (esCadena) return texto;
  const t = texto.trim();
  if (t === 'NULL') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

/** Recorre el cuerpo `(...),(...);` y devuelve las filas como arreglos de valores. */
function filas(cuerpo) {
  const salida = [];
  let i = 0;
  const n = cuerpo.length;
  while (i < n) {
    while (i < n && cuerpo[i] !== '(') { if (cuerpo[i] === ';') return salida; i += 1; }
    if (i >= n) break;
    i += 1;                                           // salta '('
    const fila = [];
    let actual = '';
    let enCadena = false;
    let seVioCadena = false;
    for (; i < n; i += 1) {
      const c = cuerpo[i];
      if (enCadena) {
        if (c === '\\') {
          const e = cuerpo[i + 1]; i += 1;
          actual += ({ n: '\n', r: '\r', t: '\t', 0: '\0', Z: '\x1a' })[e] ?? e;
        } else if (c === "'") {
          if (cuerpo[i + 1] === "'") { actual += "'"; i += 1; } else enCadena = false;
        } else actual += c;
      } else if (c === "'") { enCadena = true; seVioCadena = true; }
      else if (c === ',') { fila.push(valor(actual, seVioCadena)); actual = ''; seVioCadena = false; }
      else if (c === ')') { fila.push(valor(actual, seVioCadena)); i += 1; break; }
      else actual += c;
    }
    salida.push(fila);
  }
  return salida;
}

const cache = new Map();

/** @returns {Array<object>} filas de `tabla` en el dump (puede haber varios INSERT para la misma tabla). */
export function leerTablaDump(ruta, tabla) {
  if (!cache.has(ruta)) cache.set(ruta, readFileSync(ruta, 'latin1'));
  const sql = cache.get(ruta);
  const marca = `INSERT INTO \`${tabla}\` (`;
  const resultado = [];
  let desde = 0;
  while (true) {
    const inicio = sql.indexOf(marca, desde);
    if (inicio < 0) break;
    const finCols = sql.indexOf(') VALUES', inicio);
    const columnas = sql.slice(inicio + marca.length, finCols).split(',').map((c) => c.trim().replace(/`/g, ''));
    const cuerpo = sql.slice(finCols + ') VALUES'.length);
    // el cuerpo termina en el primer ';' fuera de cadenas: filas() lo detecta
    const lote = filas(cuerpo.slice(0, cuerpo.indexOf('\n#') > 0 ? cuerpo.indexOf('\n#') : cuerpo.length));
    for (const f of lote) resultado.push(Object.fromEntries(columnas.map((c, k) => [c, f[k]])));
    desde = finCols + 1;
  }
  return resultado;
}
