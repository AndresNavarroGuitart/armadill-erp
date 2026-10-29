// Informes contables: libros de IVA, posición de IVA, balance, mayor, diario, estados contables, deuda por antigüedad y retenciones.
// Son de solo lectura: la pantalla pide el informe con el período y muestra lo que devuelve el servidor, que es quien suma. Todos se bajan a CSV con los mismos filtros.
import { useEffect, useState } from 'react';
import { descargar, obtener } from '../api';
import { fecha, hoyISO, moneda } from '../formato';
import { Alerta, Buscador, Campo, Cargando, Selector, useAviso, Vacio } from '../ui';

type Fila = Record<string, string | number | null>;
type Col = { k: string; t: string; imp?: boolean; opc?: boolean; f?: boolean };   // imp: importe; opc: se muestra solo si el total no es cero; f: fecha
type Informe = { filas: Fila[]; totales?: Record<string, string>; avisos: string[]; [k: string]: unknown };
type Cuenta = { id: number; codigo: string; nombre: string };
type Linea = { codigo: string; cuenta: string; detalle: string | null; debe: string; haber: string };
type Asiento = { id: number; numero: number; fecha: string; descripcion: string | null; lineas: Linea[] };
type Fila2 = { codigo: string; nombre: string; importe: string };
type Estados = {
  desde: string; hasta: string; avisos: string[];
  resultados: { ingresos: Fila2[]; total_ingresos: string; egresos: Fila2[]; total_egresos: string; resultado: string };
  situacion: { al: string; activo: Fila2[]; total_activo: string; pasivo: Fila2[]; total_pasivo: string; patrimonio_neto: Fila2[]; total_patrimonio_neto: string; resultados_acumulados: string; total_pasivo_y_patrimonio: string; diferencia: string };
};

const IVA: Col[] = [
  { k: 'fecha', t: 'Fecha', f: true }, { k: 'comprobante', t: 'Comprobante' }, { k: 'razon_social', t: 'Razón social' }, { k: 'neto_gravado', t: 'Neto gravado', imp: true },
  { k: 'iva_2_5', t: 'IVA 2,5%', imp: true, opc: true }, { k: 'iva_5', t: 'IVA 5%', imp: true, opc: true }, { k: 'iva_10_5', t: 'IVA 10,5%', imp: true, opc: true }, { k: 'iva_21', t: 'IVA 21%', imp: true, opc: true }, { k: 'iva_27', t: 'IVA 27%', imp: true, opc: true },
  { k: 'iva_total', t: 'IVA', imp: true }, { k: 'no_gravado', t: 'No gravado', imp: true, opc: true }, { k: 'exento', t: 'Exento', imp: true, opc: true }, { k: 'percepcion_iva', t: 'Perc. IVA', imp: true, opc: true },
  { k: 'percepcion_iibb', t: 'Perc. IIBB', imp: true, opc: true }, { k: 'percepcion_ganancias', t: 'Perc. Gcias.', imp: true, opc: true }, { k: 'otros_tributos', t: 'Otros', imp: true, opc: true }, { k: 'total', t: 'Total', imp: true },
];
const ANTIGUEDAD: Col[] = [
  { k: 'razon_social', t: 'Razón social' }, { k: 'nro_documento', t: 'Documento' }, { k: 'a_vencer', t: 'A vencer', imp: true }, { k: 'vencido_1_30', t: '1-30 días', imp: true }, { k: 'vencido_31_60', t: '31-60', imp: true },
  { k: 'vencido_61_90', t: '61-90', imp: true }, { k: 'vencido_mas_90', t: 'Más de 90', imp: true }, { k: 'deuda', t: 'Deuda', imp: true }, { k: 'sin_aplicar', t: 'Sin aplicar', imp: true, opc: true }, { k: 'saldo_neto', t: 'Saldo neto', imp: true },
];
const IVA_DETALLE: Col[] = [
  { k: 'fecha', t: 'Fecha', f: true }, { k: 'tipo', t: 'Tipo' }, { k: 'punto_venta', t: 'Pto. vta.' }, { k: 'numero', t: 'Número' }, { k: 'nro_documento', t: 'Documento' }, { k: 'razon_social', t: 'Razón social' },
  { k: 'neto_gravado', t: 'Neto gravado', imp: true }, { k: 'no_gravado', t: 'No gravado', imp: true, opc: true }, { k: 'exento', t: 'Exento', imp: true, opc: true }, { k: 'iva_total', t: 'IVA', imp: true },
  { k: 'percepcion_iva', t: 'Perc. IVA', imp: true, opc: true }, { k: 'percepcion_iibb', t: 'Perc. IIBB', imp: true, opc: true }, { k: 'percepcion_ganancias', t: 'Perc. Gcias.', imp: true, opc: true }, { k: 'otros_tributos', t: 'Otros', imp: true, opc: true }, { k: 'total', t: 'Total', imp: true },
];
const IVA_ALICUOTAS: Col[] = [{ k: 'fecha', t: 'Fecha', f: true }, { k: 'tipo', t: 'Tipo' }, { k: 'punto_venta', t: 'Pto. vta.' }, { k: 'numero', t: 'Número' }, { k: 'razon_social', t: 'Razón social' }, { k: 'alicuota', t: 'Alícuota' }, { k: 'neto_gravado', t: 'Neto gravado', imp: true }, { k: 'iva', t: 'IVA', imp: true }];
const INFORMES: Record<string, { titulo: string; grupo: string; periodo: boolean; desdeAnio?: boolean; cols?: Col[]; ayuda: string }> = {
  'libro-iva-ventas': { titulo: 'Libro de IVA ventas', grupo: 'IVA', periodo: true, cols: IVA, ayuda: 'Comprobantes de venta del período. Las notas de crédito restan.' },
  'libro-iva-compras': { titulo: 'Libro de IVA compras', grupo: 'IVA', periodo: true, cols: IVA, ayuda: 'Facturas de proveedores del período, con el crédito fiscal y las percepciones.' },
  'posicion-iva': { titulo: 'Posición de IVA', grupo: 'IVA', periodo: true, desdeAnio: true, ayuda: 'Débito, crédito, retenciones y percepciones, mes por mes.',
    cols: [{ k: 'mes', t: 'Mes', f: true }, { k: 'debito', t: 'Débito fiscal', imp: true }, { k: 'credito', t: 'Crédito fiscal', imp: true }, { k: 'saldo_tecnico', t: 'Saldo técnico', imp: true }, { k: 'retencion', t: 'Retenciones', imp: true }, { k: 'percepcion', t: 'Percepciones', imp: true }, { k: 'saldo', t: 'Saldo', imp: true }] },
  'balance': { titulo: 'Balance de sumas y saldos', grupo: 'Contabilidad', periodo: true, desdeAnio: true, ayuda: 'Cada cuenta con su saldo anterior, lo que se movió en el período y su saldo final.',
    cols: [{ k: 'codigo', t: 'Código' }, { k: 'nombre', t: 'Cuenta' }, { k: 'saldo_anterior', t: 'Saldo anterior', imp: true }, { k: 'debe', t: 'Debe', imp: true }, { k: 'haber', t: 'Haber', imp: true }, { k: 'saldo_deudor', t: 'Saldo deudor', imp: true }, { k: 'saldo_acreedor', t: 'Saldo acreedor', imp: true }] },
  'mayor': { titulo: 'Libro mayor', grupo: 'Contabilidad', periodo: true, desdeAnio: true, ayuda: 'Los movimientos de una cuenta con el saldo después de cada uno.',
    cols: [{ k: 'fecha', t: 'Fecha', f: true }, { k: 'numero', t: 'Asiento' }, { k: 'descripcion', t: 'Descripción' }, { k: 'detalle', t: 'Detalle' }, { k: 'debe', t: 'Debe', imp: true }, { k: 'haber', t: 'Haber', imp: true }, { k: 'saldo', t: 'Saldo', imp: true }] },
  'diario': { titulo: 'Libro diario', grupo: 'Contabilidad', periodo: true, ayuda: 'Todos los asientos del período, uno debajo del otro.' },
  'estados-contables': { titulo: 'Estados contables', grupo: 'Contabilidad', periodo: true, desdeAnio: true, ayuda: 'Estado de resultados del período y situación patrimonial a la fecha de cierre.' },
  'deuda-clientes': { titulo: 'Deuda de clientes', grupo: 'Cuentas corrientes', periodo: false, cols: ANTIGUEDAD, ayuda: 'Lo que deben los clientes hoy, según cuánto hace que venció cada factura.' },
  'deuda-proveedores': { titulo: 'Deuda con proveedores', grupo: 'Cuentas corrientes', periodo: false, cols: ANTIGUEDAD, ayuda: 'Lo que se les debe a los proveedores hoy, según cuánto hace que venció cada factura.' },
  'retenciones': { titulo: 'Retenciones', grupo: 'Impuestos', periodo: true, ayuda: 'Retenciones sufridas (en cobros) y practicadas (en pagos), con su certificado.',
    cols: [{ k: 'fecha', t: 'Fecha', f: true }, { k: 'origen', t: 'Origen' }, { k: 'tipo', t: 'Impuesto' }, { k: 'jurisdiccion', t: 'Jurisdicción' }, { k: 'razon_social', t: 'Persona' }, { k: 'comprobante', t: 'Comprobante' }, { k: 'certificado_numero', t: 'Certificado' }, { k: 'base_imponible', t: 'Base', imp: true, opc: true }, { k: 'importe', t: 'Importe', imp: true }] },
  'iva-ventas-detalle': { titulo: 'IVA ventas: comprobantes', grupo: 'Planillas fiscales', periodo: true, cols: IVA_DETALLE, ayuda: 'Una fila por comprobante de venta con los códigos de ARCA, para controlar y cargar en los aplicativos. Al descargarla trae todos los campos.' },
  'iva-ventas-alicuotas': { titulo: 'IVA ventas: alícuotas', grupo: 'Planillas fiscales', periodo: true, cols: IVA_ALICUOTAS, ayuda: 'Una fila por comprobante de venta y alícuota de IVA.' },
  'iva-compras-detalle': { titulo: 'IVA compras: comprobantes', grupo: 'Planillas fiscales', periodo: true, cols: IVA_DETALLE, ayuda: 'Una fila por factura de compra con los códigos de ARCA, para controlar y cargar en los aplicativos. Al descargarla trae todos los campos.' },
  'iva-compras-alicuotas': { titulo: 'IVA compras: alícuotas', grupo: 'Planillas fiscales', periodo: true, cols: IVA_ALICUOTAS, ayuda: 'Una fila por factura de compra y alícuota de IVA.' },
  'percepciones': { titulo: 'Percepciones', grupo: 'Planillas fiscales', periodo: true, ayuda: 'Percepciones sufridas (en las compras) y practicadas (en las ventas), por impuesto y jurisdicción.',
    cols: [{ k: 'fecha', t: 'Fecha', f: true }, { k: 'origen', t: 'Origen' }, { k: 'impuesto', t: 'Impuesto' }, { k: 'jurisdiccion', t: 'Jurisdicción' }, { k: 'razon_social', t: 'Persona' }, { k: 'nro_documento', t: 'Documento' }, { k: 'comprobante', t: 'Comprobante' }, { k: 'base_imponible', t: 'Base', imp: true, opc: true }, { k: 'importe', t: 'Importe', imp: true }] },
};
const GRUPOS = [...new Set(Object.values(INFORMES).map((i) => i.grupo))];
const ORIGEN: Record<string, string> = { sufrida: 'Sufrida', practicada: 'Practicada' }, IMPUESTO: Record<string, string> = { iva: 'IVA', ganancias: 'Ganancias', iibb: 'Ingresos Brutos', suss: 'SUSS' };
const POR_PAGINA = 50;

const primeroDeMes = (d: string) => `${d.slice(0, 8)}01`;
const anterior = (d: string) => { const [a, m] = d.split('-').map(Number); const p = m === 1 ? [a - 1, 12] : [a, m - 1]; const ult = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); return [`${p[0]}-${String(p[1]).padStart(2, '0')}-01`, `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(ult).padStart(2, '0')}`] as const; };
const importe = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number(v) === 0 ? '—' : moneda(String(v)));

export function Informes() {
  const avisar = useAviso(), hoy = hoyISO();
  const [clave, setClave] = useState('libro-iva-ventas');
  const meta = INFORMES[clave];
  const [desde, setDesde] = useState(primeroDeMes(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [cuentaTexto, setCuentaTexto] = useState('');
  const [origen, setOrigen] = useState('');
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Informe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  const cambiarInforme = (c: string) => { setClave(c); setPagina(0); setDatos(null); setError(null); const m = INFORMES[c]; setDesde(m.desdeAnio ? `${hoy.slice(0, 4)}-01-01` : primeroDeMes(hoy)); setHasta(hoy); };
  const filtros = () => ({ ...(meta.periodo ? { desde, hasta } : {}), ...(clave === 'mayor' ? { cuenta_id: cuenta?.id } : {}), ...(clave === 'retenciones' ? { origen, tipo } : {}), ...(clave === 'percepciones' ? { origen, impuesto: tipo } : {}), ...(clave === 'diario' ? { limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA } : {}) });
  const lista = clave === 'mayor' && !cuenta ? null : JSON.stringify([clave, filtros()]);

  useEffect(() => { setPagina(0); }, [desde, hasta, cuenta, origen, tipo]);
  useEffect(() => {
    if (!lista) { setDatos(null); setError(null); return; }
    const ctl = new AbortController(); setError(null);
    obtener<Informe>(`/api/informes/${clave}`, JSON.parse(lista)[1], ctl.signal).then(setDatos).catch((e) => { if ((e as Error).name !== 'AbortError') { setDatos(null); setError(e.message); } });
    return () => ctl.abort();
  }, [lista, clave]);

  async function bajar() {
    setBajando(true);
    try { await descargar(`/api/informes/${clave}`, { ...filtros(), ...(clave === 'diario' ? { limite: undefined, desplazamiento: undefined } : {}), formato: 'csv' }, `${clave}.csv`); avisar('Se descargó el CSV.'); }
    catch (e) { setError((e as Error).message); } finally { setBajando(false); }
  }
  const mes = () => { setDesde(primeroDeMes(hoy)); setHasta(hoy); };
  const mesAnterior = () => { const [d, h] = anterior(hoy); setDesde(d); setHasta(h); };
  const anio = () => { setDesde(`${hoy.slice(0, 4)}-01-01`); setHasta(hoy); };

  return (
    <>
      <div className="cabecera"><div><h1>Informes</h1><p>{meta.ayuda}</p></div></div>
      <div className="herramientas">
        <Selector etiqueta="Informe" value={clave} onChange={(e) => cambiarInforme(e.target.value)}>
          {GRUPOS.map((g) => <optgroup key={g} label={g}>{Object.entries(INFORMES).filter(([, i]) => i.grupo === g).map(([k, i]) => <option key={k} value={k}>{i.titulo}</option>)}</optgroup>)}
        </Selector>
        {meta.periodo && <><Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <span className="acciones"><button className="btn chico" onClick={mes}>Este mes</button><button className="btn chico" onClick={mesAnterior}>Mes anterior</button><button className="btn chico" onClick={anio}>Este año</button></span></>}
        {(clave === 'retenciones' || clave === 'percepciones') && <>
          <Selector etiqueta="Origen" value={origen} onChange={(e) => setOrigen(e.target.value)}><option value="">Todas</option><option value="sufrida">Sufridas</option><option value="practicada">Practicadas</option></Selector>
          <Selector etiqueta="Impuesto" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{Object.entries(IMPUESTO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector></>}
        <div style={{ flex: 1 }} /><button className="btn" disabled={bajando || !lista || !datos} onClick={() => void bajar()}>{bajando ? 'Descargando…' : 'Descargar CSV'}</button>
      </div>
      {clave === 'mayor' && <div style={{ maxWidth: 420, marginBottom: 14 }}><Buscador<Cuenta> etiqueta="Cuenta" texto={cuentaTexto} placeholder="Código o nombre de la cuenta" onTexto={(t) => { setCuentaTexto(t); setCuenta(null); }}
        buscar={(q) => obtener<{ datos: Cuenta[] }>('/api/informes/cuentas', { q: q || undefined, limite: 10 }).then((r) => r.datos)} mostrar={(x) => <><span>{x.nombre}</span><span className="muted">{x.codigo}</span></>} onElegir={(x) => { setCuenta(x); setCuentaTexto(`${x.codigo} · ${x.nombre}`); }} /></div>}
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && lista && <Cargando />}
      {!lista && <div className="tarjeta"><Vacio titulo="Elegí una cuenta">Escribí el código o el nombre para ver sus movimientos.</Vacio></div>}
      {datos && datos.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
      {datos && clave === 'diario' && <Diario d={datos as unknown as { filas: Asiento[]; total: number; totales: Record<string, string> }} pagina={pagina} onPagina={setPagina} />}
      {datos && clave === 'estados-contables' && <EstadosContables e={datos as unknown as Estados} />}
      {datos && meta.cols && <Tabla clave={clave} cols={meta.cols} d={datos} />}
    </>
  );
}

function Tabla({ clave, cols, d }: { clave: string; cols: Col[]; d: Informe }) {
  const visibles = cols.filter((c) => !c.opc || (d.totales && Number(d.totales[c.k] ?? 0) !== 0) || (clave === 'mayor'));
  if (d.filas.length === 0) return <div className="tarjeta"><Vacio titulo="No hay datos para ese período">Probá con otras fechas.</Vacio></div>;
  const celda = (c: Col, f: Fila) => {
    const v = f[c.k];
    if (c.k === 'comprobante' && clave.startsWith('libro-iva')) return `${f.tipo} ${f.numero_formateado ?? ''}`.trim();
    if (c.k === 'origen') return ORIGEN[String(v)] ?? v;
    if (c.k === 'tipo' && clave === 'retenciones') return IMPUESTO[String(v)] ?? v;
    if (c.k === 'mes') return String(v ?? '').slice(0, 7).split('-').reverse().join('/');
    if (c.f) return fecha(String(v));
    if (c.imp) return importe(v);
    return v ?? '';
  };
  const final = clave === 'mayor' ? d.totales?.saldo_final : null;
  return (
    <>
      {clave === 'mayor' && <p className="muted" style={{ margin: '0 0 8px' }}>{(d.cuenta as Cuenta).codigo} · {(d.cuenta as Cuenta).nombre} — saldo anterior <strong className="num">{moneda(String(d.saldo_anterior))}</strong></p>}
      <div className="tabla-caja">
        <table>
          <thead><tr>{visibles.map((c) => <th key={c.k} className={c.imp ? 'num' : undefined}>{c.t}</th>)}</tr></thead>
          <tbody>{d.filas.map((f, i) => <tr key={i}>{visibles.map((c) => <td key={c.k} className={c.imp ? 'num' : undefined}>{celda(c, f)}</td>)}</tr>)}</tbody>
          {d.totales && (
            <tfoot><tr>{visibles.map((c, i) => <td key={c.k} className={c.imp ? 'num' : undefined} style={{ fontWeight: 600 }}>{i === 0 ? 'Totales' : c.imp ? importe(clave === 'mayor' && c.k === 'saldo' ? final : d.totales?.[c.k]) : ''}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {clave === 'retenciones' && Array.isArray(d.resumen) && (d.resumen as { origen: string; tipo: string; cantidad: number; importe: string }[]).length > 0 && (
        <p className="muted" style={{ marginTop: 10 }}>{(d.resumen as { origen: string; tipo: string; cantidad: number; importe: string }[]).map((r) => `${ORIGEN[r.origen]} de ${IMPUESTO[r.tipo]}: ${r.cantidad} por ${moneda(r.importe)}`).join(' · ')}</p>
      )}
      {typeof d.cantidad === 'number' && <p className="muted" style={{ marginTop: 10 }}>{d.cantidad} {clave.endsWith('alicuotas') ? 'fila' : 'comprobante'}{d.cantidad === 1 ? '' : 's'}.</p>}
    </>
  );
}

function Diario({ d, pagina, onPagina }: { d: { filas: Asiento[]; total: number; totales: Record<string, string> }; pagina: number; onPagina: (n: number) => void }) {
  const paginas = Math.max(1, Math.ceil(d.total / POR_PAGINA));
  if (d.filas.length === 0) return <div className="tarjeta"><Vacio titulo="No hay asientos en ese período" /></div>;
  return (
    <>
      <p className="muted" style={{ margin: '0 0 8px' }}>{d.total} asiento{d.total === 1 ? '' : 's'} en el período. Total de la página: debe {moneda(d.totales.debe)} · haber {moneda(d.totales.haber)}.</p>
      {d.filas.map((a) => (
        <div className="tabla-caja" key={a.id} style={{ marginBottom: 10 }}>
          <table>
            <caption style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600 }}>Asiento {a.numero} · {fecha(a.fecha)}{a.descripcion ? ` · ${a.descripcion}` : ''}</caption>
            <thead><tr><th>Cuenta</th><th>Detalle</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
            <tbody>{a.lineas.map((l, i) => <tr key={i}><td><span className="muted">{l.codigo}</span> {l.cuenta}</td><td>{l.detalle ?? ''}</td><td className="num">{importe(l.debe)}</td><td className="num">{importe(l.haber)}</td></tr>)}</tbody>
          </table>
        </div>
      ))}
      {d.total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => onPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => onPagina(pagina + 1)}>Siguiente</button></span></div>}
    </>
  );
}

function Seccion({ titulo, filas, total, etiquetaTotal }: { titulo: string; filas: Fila2[]; total: string; etiquetaTotal: string }) {
  return (
    <>
      <tr><th colSpan={2} style={{ background: 'var(--surface-2, transparent)' }}>{titulo}</th></tr>
      {filas.length === 0 && <tr><td colSpan={2} className="muted">Sin movimientos</td></tr>}
      {filas.map((f) => <tr key={f.codigo}><td><span className="muted">{f.codigo}</span> {f.nombre}</td><td className="num">{moneda(f.importe)}</td></tr>)}
      <tr><td style={{ fontWeight: 600 }}>{etiquetaTotal}</td><td className="num" style={{ fontWeight: 600 }}>{moneda(total)}</td></tr>
    </>
  );
}
function EstadosContables({ e }: { e: Estados }) {
  const r = e.resultados, s = e.situacion;
  return (
    <div className="rejilla" style={{ alignItems: 'start' }}>
      <div className="tabla-caja"><table>
        <caption style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600 }}>Estado de resultados · {fecha(e.desde)} al {fecha(e.hasta)}</caption>
        <tbody>
          <Seccion titulo="Ingresos" filas={r.ingresos} total={r.total_ingresos} etiquetaTotal="Total de ingresos" />
          <Seccion titulo="Egresos" filas={r.egresos} total={r.total_egresos} etiquetaTotal="Total de egresos" />
          <tr><td style={{ fontWeight: 700 }}>{Number(r.resultado) >= 0 ? 'Ganancia del período' : 'Pérdida del período'}</td><td className="num" style={{ fontWeight: 700 }}>{moneda(r.resultado)}</td></tr>
        </tbody>
      </table></div>
      <div className="tabla-caja"><table>
        <caption style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600 }}>Situación patrimonial al {fecha(s.al)}</caption>
        <tbody>
          <Seccion titulo="Activo" filas={s.activo} total={s.total_activo} etiquetaTotal="Total del activo" />
          <Seccion titulo="Pasivo" filas={s.pasivo} total={s.total_pasivo} etiquetaTotal="Total del pasivo" />
          <Seccion titulo="Patrimonio neto" filas={s.patrimonio_neto} total={s.total_patrimonio_neto} etiquetaTotal="Total del patrimonio neto" />
          <tr><td>Resultados acumulados</td><td className="num">{moneda(s.resultados_acumulados)}</td></tr>
          <tr><td style={{ fontWeight: 700 }}>Pasivo + patrimonio + resultados</td><td className="num" style={{ fontWeight: 700 }}>{moneda(s.total_pasivo_y_patrimonio)}</td></tr>
        </tbody>
      </table></div>
    </div>
  );
}
