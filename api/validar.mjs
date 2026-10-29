// Validación de lo que llega por la API. Cada campo se valida por tipo y se devuelven TODOS los errores juntos, por campo.
import { invalido } from './errores.mjs';

const PREFIJOS_CUIT = ['20', '23', '24', '25', '26', '27', '30', '33', '34', '50', '51', '55'];
export function cuitValido(c) {
  if (!/^\d{11}$/.test(c) || !PREFIJOS_CUIT.includes(c.slice(0, 2))) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < 10; i++) s += Number(c[i]) * pesos[i];
  let dv = 11 - (s % 11); if (dv === 11) dv = 0; else if (dv === 10) dv = 9; return dv === Number(c[10]);
}

const limpiar = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaReal = (s) => FECHA.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

/* Tipos: texto, entero, importe (decimal exacto en texto), porcentaje, booleano, fecha, enum, lista, objeto. */
const TIPOS = {
  texto: (v, o) => { if (typeof v !== 'string') return ['tiene que ser texto']; const t = limpiar(v); if (o.min && t.length < o.min) return [`tiene que tener al menos ${o.min} caracteres`]; if (t.length > (o.max || 200)) return [`tiene que tener como máximo ${o.max || 200} caracteres`]; if (o.patron && !o.patron.test(t)) return [o.mensajePatron || 'tiene un formato inválido']; return [null, o.mayusculas ? t.toUpperCase() : t]; },
  entero: (v, o) => { const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v; if (!Number.isSafeInteger(n)) return ['tiene que ser un número entero']; if (o.min != null && n < o.min) return [`tiene que ser al menos ${o.min}`]; if (o.max != null && n > o.max) return [`tiene que ser como máximo ${o.max}`]; return [null, n]; },
  importe: (v, o) => { const t = typeof v === 'number' ? String(v) : v; if (typeof t !== 'string' || !/^-?\d+(\.\d{1,4})?$/.test(t)) return ['tiene que ser un importe (por ejemplo 1250.50)']; const n = Number(t); if (o.min != null && n < o.min) return [`tiene que ser al menos ${o.min}`]; if (o.max != null && n > o.max) return [`tiene que ser como máximo ${o.max}`]; return [null, t.replace(/^(-?)0+(?=\d)/, '$1')]; },
  porcentaje: (v, o) => { const r = TIPOS.importe(v, { min: 0, max: o.max ?? 99.99 }); return r[0] ? [r[0].replace('un importe (por ejemplo 1250.50)', 'un porcentaje entre 0 y 99,99')] : r; },
  booleano: (v) => (typeof v === 'boolean' ? [null, v] : ['tiene que ser verdadero o falso']),
  fecha: (v) => (typeof v === 'string' && fechaReal(v) ? [null, v] : ['tiene que ser una fecha válida (aaaa-mm-dd)']),
  enum: (v, o) => (o.valores.includes(v) ? [null, v] : [`tiene que ser uno de: ${o.valores.join(', ')}`]),
};

export function validar(esquema, cuerpo, { parcial = false } = {}) {
  const errores = {}, valor = {};
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw invalido({ _: 'El cuerpo tiene que ser un objeto.' });
  for (const k of Object.keys(cuerpo)) if (!(k in esquema)) errores[k] = 'no es un campo que se pueda enviar';
  for (const [campo, def] of Object.entries(esquema)) {
    const v = cuerpo[campo];
    if (v === undefined || v === null) { if (def.requerido && !parcial) errores[campo] = 'es obligatorio'; else if (v === null && def.nulo) valor[campo] = null; continue; }
    if (def.tipo === 'lista') {
      if (!Array.isArray(v)) { errores[campo] = 'tiene que ser una lista'; continue; }
      if (def.min && v.length < def.min) { errores[campo] = `tiene que tener al menos ${def.min} elemento${def.min === 1 ? '' : 's'}`; continue; }
      if (v.length > (def.max || 100)) { errores[campo] = `tiene como máximo ${def.max || 100} elementos`; continue; }
      const salida = [];
      v.forEach((el, i) => { try { salida.push(validar(def.elemento, el).valor); } catch (e) { for (const [k, m] of Object.entries(e.campos || {})) errores[`${campo}[${i}].${k}`] = m; } });
      valor[campo] = salida; continue;
    }
    if (def.tipo === 'objeto') {
      try { valor[campo] = validar(def.campos, v).valor; } catch (e) { for (const [k, m] of Object.entries(e.campos || {})) errores[`${campo}.${k}`] = m; }
      continue;
    }
    const [e, ok] = TIPOS[def.tipo](v, def);
    if (e) errores[campo] = e; else valor[campo] = ok;
  }
  if (Object.keys(errores).length) throw invalido(errores);
  return { valor };
}
