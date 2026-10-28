// Seguridad del asistente: validación de lo que entra, limpieza de lo que sale y cuenta de lo que cuesta.
import { RUTAS } from './corpus.mjs';

/* ---------- entrada ---------- */
export const MAX_PREGUNTA = 600, MAX_TURNOS = 20, MAX_MENSAJE_HISTORIAL = 4000;

export function validarEntrada(pregunta) {
  if (typeof pregunta !== 'string') return { ok: false, error: 'La pregunta tiene que ser texto.' };
  const texto = pregunta.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!texto) return { ok: false, error: 'Escribí una pregunta.' };
  if (texto.length > MAX_PREGUNTA) return { ok: false, error: `La pregunta es demasiado larga (máximo ${MAX_PREGUNTA} caracteres).` };
  return { ok: true, texto };
}

/* El historial viene del navegador: se trata como no confiable. Solo texto, solo dos roles, con tope. */
export function limpiarHistorial(historial, max = MAX_TURNOS) {
  if (!Array.isArray(historial)) return [];
  const salida = [];
  for (const m of historial.slice(-max)) {
    if (!m || (m.rol !== 'user' && m.rol !== 'assistant') || typeof m.texto !== 'string') continue;
    const texto = m.texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_MENSAJE_HISTORIAL).trim();
    if (texto) salida.push({ role: m.rol, content: texto });
  }
  while (salida.length && salida[0].role === 'assistant') salida.shift();
  return salida;
}

/* ---------- salida ---------- */
const FUENTES = new Set(['guia', 'ref', 'ninguna']);
const MARCA = /\[\[(ir|fuente):([^\]\n]*)\]\]/g;
const etiquetaLimpia = (e, ruta) => {
  const t = String(e || '').replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N} .,:;()¿?¡!/-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t || RUTAS[ruta];
};

/* Limpia una línea de texto: sin HTML, sin imágenes, sin enlaces (ni de markdown ni sueltos). Los marcadores se manejan aparte. */
export function limpiarLinea(linea) {
  return linea
    .replace(/<[^>\n]*>/g, '')                          // etiquetas HTML
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')            // imágenes: queda el texto alternativo
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')             // enlaces de markdown: queda el texto
    .replace(/\b(?:https?|ftp|javascript|data):[^\s)]*/gi, '[enlace omitido]')
    .replace(/\bwww\.[^\s)]+/gi, '[enlace omitido]');
}

/* Filtro incremental: recibe pedazos de texto del modelo y devuelve pedazos ya limpios.
   Retiene todo lo que podría ser un marcador o un enlace hasta tener la línea completa. */
export function crearFiltro() {
  let buf = '', fuente = null; const acciones = [];
  const procesar = (linea) => {
    let resto = linea.replace(MARCA, (_, tipo, valor) => {
      if (tipo === 'ir') {
        const [ruta, etiqueta] = valor.split('|'), r = (ruta || '').trim();
        if (RUTAS[r] && acciones.length < 3 && !acciones.some((a) => a.ruta === r)) acciones.push({ ruta: r, etiqueta: etiquetaLimpia(etiqueta, r) });
      } else if (FUENTES.has(valor.trim())) fuente = valor.trim();
      return '';
    });
    const hizoMarca = resto !== linea; resto = limpiarLinea(resto);
    return hizoMarca && !resto.trim() ? null : resto;
  };
  const sacarLineas = () => {
    const salida = []; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = procesar(buf.slice(0, i)); buf = buf.slice(i + 1); if (l !== null) salida.push(l + '\n'); }
    if (buf.length > 300 && !/[\[<!]|https?|www\./i.test(buf)) {        // párrafo largo sin nada riesgoso: se libera por tramos
      const k = buf.lastIndexOf(' '); if (k > 0) { salida.push(limpiarLinea(buf.slice(0, k))); buf = buf.slice(k); }
    }
    return salida.join('');
  };
  return {
    push(delta) { buf += delta; return sacarLineas(); },
    fin() { const l = procesar(buf); buf = ''; return l === null ? '' : l; },
    get acciones() { return acciones; },
    get fuente() { return fuente; },
  };
}

/* Versión de una sola pasada (para respuestas completas y pruebas). */
export function procesarSalida(texto) {
  const f = crearFiltro(); const t = f.push(texto) + f.fin();
  return { texto: t.replace(/\n{3,}/g, '\n\n').trim(), acciones: f.acciones, fuente: f.fuente };
}

/* ---------- costo ---------- */
/* USD por millón de tokens. Opus 5.5: entrada 4, salida 20, lectura de caché 0,20 (0,05×), escritura 1,25× (5 min) o 2× (1 h). */
export const PRECIOS = {
  'claude-opus-5-5': { entrada: 4, salida: 20, cacheLectura: 0.2, escritura5m: 5, escritura1h: 8 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, cacheLectura: 0.2, escritura5m: 2.5, escritura1h: 4 },
};
export function calcularCosto(uso, modelo = 'claude-opus-5-5') {
  const p = PRECIOS[modelo] || PRECIOS['claude-opus-5-5'];
  const c5 = uso.cache_creation ? uso.cache_creation.ephemeral_5m_input_tokens || 0 : uso.cache_creation_input_tokens || 0;
  const c1 = uso.cache_creation ? uso.cache_creation.ephemeral_1h_input_tokens || 0 : 0;
  const usd = ((uso.input_tokens || 0) * p.entrada + (uso.cache_read_input_tokens || 0) * p.cacheLectura + c5 * p.escritura5m + c1 * p.escritura1h + (uso.output_tokens || 0) * p.salida) / 1e6;
  return Math.round(usd * 1e5) / 1e5;
}
