// Presentación de importes y fechas (es-AR). Los importes son texto decimal exacto: se separan por partes, nunca pasan por Number.
const miles = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function moneda(valor: string | null | undefined): string {
  if (valor == null || valor === '') return '—';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(valor).trim());
  if (!m) return String(valor);
  const entero = miles(m[2].replace(/^0+(?=\d)/, ''));
  const decimales = (m[3] ?? '').padEnd(2, '0').slice(0, 2);
  return `${m[1]}$ ${entero},${decimales}`;
}
export const cantidad = (valor: string | null | undefined): string => {
  if (valor == null) return '—';
  const [e, d = ''] = String(valor).split('.');
  const dd = d.replace(/0+$/, '');
  return dd ? `${miles(e)},${dd}` : miles(e);
};
export const fecha = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
/** Fecha y hora de un instante (ISO) en la zona del navegador. */
export const fechaHora = (iso: string | null | undefined, conSegundos = false): string => {
  if (!iso) return '—';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(conSegundos ? { second: '2-digit' } : {}), hour12: false });
};
export const hoyISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const cuitConGuiones = (c: string): string => (/^\d{11}$/.test(c) ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
export const CONDICIONES_IVA: Record<number, string> = { 1: 'Responsable inscripto', 4: 'Exento', 5: 'Consumidor final', 6: 'Responsable monotributo', 13: 'Monotributista social', 16: 'Monotributo trabajador independiente' };
export const nombreCondicion = (c: number): string => CONDICIONES_IVA[c] ?? `Condición ${c}`;
/** Acepta "1.234,56" o "1234.56" y devuelve texto decimal para la API; vacío → ''. No valida rangos: eso lo hace la API. */
export function aDecimal(escrito: string): string {
  const t = escrito.trim().replace(/\s/g, '');
  if (!t) return '';
  if (t.includes(',')) return t.replace(/\./g, '').replace(',', '.');
  return /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
}
