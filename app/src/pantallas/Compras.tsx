// Compras: facturas de proveedores. Se cargan los datos del papel (letra, punto de venta y número del proveedor, renglones, percepciones) y el TOTAL
// de la factura; el servidor calcula, compara y solo carga si coincide. La pantalla no calcula importes: muestra lo que devuelve el servidor.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda } from '../formato';
import type { Articulo, ComprobanteResumen, Cuenta, Deposito, Jurisdiccion, Pagina, PreviaCompra, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';
import { ComprobanteDetalle, ESTADOS } from './ComprobanteDetalle';

const POR_PAGINA = 25;

export function Compras() {
  const { puede } = useSesion();
  const [nueva, setNueva] = useState(false);
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<ComprobanteResumen> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => { setPagina(0); }, [estado, desde, hasta]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<ComprobanteResumen>>('/api/compras/facturas', { estado, desde, hasta, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal)
      .then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [estado, desde, hasta, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  if (nueva) return <NuevaCompra onVolver={() => setNueva(false)} onCargada={(id) => { setNueva(false); setRecarga((n) => n + 1); setAbierto(id); }} />;
  return (
    <>
      <div className="cabecera">
        <div><h1>Compras</h1><p>Facturas de proveedores: ingresan la mercadería, actualizan el costo y suman la deuda con el proveedor.</p></div>
        <div className="acciones">{puede('compras.cargar') && <button className="btn primario" onClick={() => setNueva(true)}>Cargar factura de compra</button>}</div>
      </div>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay facturas de compra">{desde || hasta || estado ? 'Probá con otro período o estado.' : 'Cuando cargues las facturas de tus proveedores van a aparecer acá.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Comprobante</th><th>Fecha</th><th>Proveedor</th><th className="num">Total</th><th>Estado</th></tr></thead>
            <tbody>{datos.datos.map((c) => (
              <tr key={c.id} className="clic" onClick={() => setAbierto(c.id)}>
                <td><strong>{c.tipo} {c.numero_formateado ?? '—'}</strong></td><td>{fecha(c.fecha)}</td><td>{c.cliente}</td><td className="num">{moneda(c.imp_total)}</td>
                <td><Etiqueta tono={ESTADOS[c.estado]?.tono ?? 'neutro'}>{ESTADOS[c.estado]?.texto ?? c.estado}</Etiqueta></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {abierto !== null && <ComprobanteDetalle modo="compra" id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} onAbrir={(id) => setAbierto(id)} />}
    </>
  );
}

/* ====================== Cargar una factura ====================== */
type Linea = { uid: number; articulo: Articulo | null; texto: string; cantidad: string; precio: string; desc: string; alicuota: string; tratamiento: string; cuenta: string; deposito: string };
type Tributo = { uid: number; tipo: string; jurisdiccion: string; importe: string };
let contador = 0;
const nuevaLinea = (): Linea => ({ uid: ++contador, articulo: null, texto: '', cantidad: '1', precio: '', desc: '', alicuota: '21', tratamiento: 'gravado', cuenta: '', deposito: '' });
const TRIBUTOS: Record<string, string> = { percepcion_iva: 'Percepción de IVA', percepcion_iibb: 'Percepción de Ingresos Brutos', percepcion_ganancias: 'Percepción de Ganancias', percepcion_suss: 'Percepción de SUSS', impuesto_interno: 'Impuesto interno', impuesto_municipal: 'Impuesto municipal', otro: 'Otro tributo' };
const ALICUOTAS = ['21', '10.5', '27', '5', '2.5', '0'];

function NuevaCompra({ onVolver, onCargada }: { onVolver: () => void; onCargada: (id: number) => void }) {
  const avisar = useAviso();
  const { yo } = useSesion();
  const empresaRI = yo?.empresa_activa?.condicion_iva_codigo === 1;
  const [provTexto, setProvTexto] = useState('');
  const [proveedor, setProveedor] = useState<Tercero | null>(null);
  const [letra, setLetra] = useState('A');
  const [pv, setPv] = useState('');
  const [numero, setNumero] = useState('');
  const [fechaF, setFechaF] = useState(hoyISO());
  const [vto, setVto] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([nuevaLinea()]);
  const [tributos, setTributos] = useState<Tributo[]>([]);
  const [total, setTotal] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [jurisdicciones, setJurisdicciones] = useState<Jurisdiccion[]>([]);
  const [previa, setPrevia] = useState<PreviaCompra | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const discrimina = (letra === 'A' || letra === 'M') && empresaRI;

  useEffect(() => {
    obtener<{ datos: Deposito[] }>('/api/depositos').then((r) => setDepositos(r.datos.filter((d) => d.activo))).catch(() => setDepositos([]));
    obtener<{ datos: Cuenta[] }>('/api/plan-cuentas', { limite: 200 }).then((r) => setCuentas(r.datos)).catch(() => setCuentas([]));
    obtener<{ datos: Jurisdiccion[] }>('/api/catalogos/jurisdicciones').then((r) => setJurisdicciones(r.datos)).catch(() => setJurisdicciones([]));
  }, []);
  const variosDepositos = depositos.length > 1;

  const pedido = useMemo(() => {
    if (!proveedor || !pv.trim() || !numero.trim()) return null;
    const items = lineas.filter((l) => (l.articulo || l.texto.trim()) && l.cantidad.trim() && l.precio.trim()).map((l) => ({
      ...(l.articulo ? { articulo_id: l.articulo.id } : { descripcion: l.texto.trim() }), cantidad: aDecimal(l.cantidad), precio_unitario: aDecimal(l.precio), ...(l.desc.trim() ? { desc_pct: aDecimal(l.desc) } : {}),
      ...(discrimina ? { tratamiento: l.tratamiento, ...(l.tratamiento === 'gravado' && !l.articulo ? { alicuota: l.alicuota } : {}) } : {}),
      ...(l.cuenta && !l.articulo ? { cuenta_id: Number(l.cuenta) } : {}), ...(variosDepositos && l.articulo?.controla_stock ? { deposito_id: Number(l.deposito || depositos[0].id) } : {}),
    }));
    if (!items.length) return null;
    return {
      tercero_id: proveedor.id, letra, punto_venta: Number(pv), numero: Number(numero), fecha: fechaF, ...(vto ? { fecha_vto_pago: vto } : {}), total: aDecimal(total) || '0', ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}), items,
      ...(tributos.length ? { tributos: tributos.filter((t) => t.importe.trim()).map((t) => ({ tipo: t.tipo, ...(t.tipo === 'percepcion_iibb' && t.jurisdiccion ? { jurisdiccion_codigo: Number(t.jurisdiccion) } : {}), importe: aDecimal(t.importe) })) } : {}),
    };
  }, [proveedor, letra, pv, numero, fechaF, vto, lineas, tributos, total, observaciones, discrimina, variosDepositos, depositos]);
  const huella = JSON.stringify(pedido), retrasada = useRetraso(huella, 400);
  useEffect(() => {
    if (!pedido) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaCompra>('POST', '/api/compras/facturas/calcular', pedido, { senal: ctl.signal })
      .then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);

  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiarLinea = (uid: number, c: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...c } : l)));
  const indice = (uid: number) => lineas.filter((l) => (l.articulo || l.texto.trim()) && l.cantidad.trim() && l.precio.trim()).findIndex((l) => l.uid === uid);
  const errLinea = (uid: number, c: string) => { const i = indice(uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  async function cargar(ev: FormEvent) {
    ev.preventDefault(); if (!pedido) return;
    setTrabajando(true); setError(null);
    try { const r = await enviar<{ id: number; tipo: string; numero_formateado: string }>('POST', '/api/compras/facturas', pedido); avisar(`${r.tipo} ${r.numero_formateado} cargada.`); onCargada(r.id); }
    catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['tercero_id', 'letra', 'punto_venta', 'numero', 'fecha', 'fecha_vto_pago', 'total', ...lineas.flatMap((_, i) => ['articulo_id', 'descripcion', 'cantidad', 'precio_unitario', 'desc_pct', 'alicuota', 'cuenta_id', 'deposito_id'].map((c) => `items[${i}].${c}`)), ...tributos.flatMap((_, i) => [`tributos[${i}].jurisdiccion_codigo`, `tributos[${i}].importe`, `tributos[${i}].tipo`])]);

  return (
    <>
      <div className="cabecera"><div><h1>Cargar factura de compra</h1><p>Cargá los datos tal cual figuran en la factura del proveedor. El total tiene que coincidir.</p></div><div className="acciones"><button className="btn" onClick={onVolver}>Volver</button></div></div>
      <form onSubmit={cargar} noValidate>
        <div className="factura">
          <div>
            <div className="tarjeta">
              {general && <Alerta>{general}</Alerta>}
              <div className="rejilla">
                <div className="ancho"><Buscador<Tercero> etiqueta="Proveedor" texto={provTexto} placeholder="Buscá por nombre o CUIT" autoFocus error={campos.tercero_id}
                  onTexto={(t) => { setProvTexto(t); setProveedor(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/proveedores', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
                  mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{t.tipo_documento} {t.nro_documento}</span></>} onElegir={(t) => { setProveedor(t); setProvTexto(t.razon_social); }} /></div>
                <Selector etiqueta="Letra" value={letra} error={campos.letra} onChange={(e) => setLetra(e.target.value)}><option value="A">Factura A</option><option value="B">Factura B</option><option value="C">Factura C</option><option value="M">Factura M</option></Selector>
                <Campo etiqueta="Punto de venta" inputMode="numeric" value={pv} error={campos.punto_venta} placeholder="0004" onChange={(e) => setPv(e.target.value.replace(/\D/g, ''))} />
                <Campo etiqueta="Número" inputMode="numeric" value={numero} error={campos.numero} placeholder="00001234" onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} />
                <Campo etiqueta="Fecha de la factura" type="date" value={fechaF} error={campos.fecha} onChange={(e) => setFechaF(e.target.value)} />
                <Campo etiqueta="Vencimiento del pago" type="date" value={vto} error={campos.fecha_vto_pago} ayuda="Opcional: sin completar, se calcula con el plazo del proveedor." onChange={(e) => setVto(e.target.value)} />
              </div>
              {!discrimina && <Alerta tipo="info"><span style={{ display: 'block', marginTop: 0 }}>{letra === 'A' || letra === 'M' ? 'Esta empresa no es responsable inscripta: no toma crédito fiscal. ' : `En una factura ${letra} el IVA no se discrimina. `}Cargá el <strong>precio final</strong> (con IVA incluido): todo va al costo.</span></Alerta>}
            </div>
            <div className="tarjeta">
              <h2 style={{ marginBottom: 6 }}>Renglones</h2>
              {lineas.map((l, i) => (
                <div className={`renglon renglon-compra`} key={l.uid}>
                  <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo o descripción' : `Renglón ${i + 1}`} texto={l.texto} placeholder="Elegí un artículo o escribí una descripción" error={errLinea(l.uid, 'articulo_id') ?? errLinea(l.uid, 'descripcion')}
                    onTexto={(t) => cambiarLinea(l.uid, { articulo: null, texto: t })} buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
                    mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.controla_stock ? 'con stock' : a.tipo}</span></>} onElegir={(a) => cambiarLinea(l.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}` })} />
                  <Campo etiqueta="Cantidad" inputMode="decimal" value={l.cantidad} error={errLinea(l.uid, 'cantidad')} onChange={(e) => cambiarLinea(l.uid, { cantidad: e.target.value })} />
                  <Campo etiqueta={discrimina ? 'Precio neto' : 'Precio final'} inputMode="decimal" value={l.precio} error={errLinea(l.uid, 'precio_unitario')} onChange={(e) => cambiarLinea(l.uid, { precio: e.target.value })} />
                  <Campo etiqueta="Desc. %" inputMode="decimal" value={l.desc} error={errLinea(l.uid, 'desc_pct')} onChange={(e) => cambiarLinea(l.uid, { desc: e.target.value })} />
                  <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))}>×</button>
                  <div className="detalle-renglon">
                    {discrimina && <Selector etiqueta="IVA" value={l.articulo ? 'articulo' : l.tratamiento === 'gravado' ? l.alicuota : l.tratamiento} disabled={!!l.articulo} error={errLinea(l.uid, 'alicuota')}
                      ayuda={l.articulo ? 'Lo toma del artículo' : undefined} onChange={(e) => { const v = e.target.value; cambiarLinea(l.uid, v === 'exento' || v === 'no_gravado' ? { tratamiento: v } : { tratamiento: 'gravado', alicuota: v }); }}>
                      {l.articulo ? <option value="articulo">Del artículo</option> : <>{ALICUOTAS.map((a) => <option key={a} value={a}>{a.replace('.', ',')} %</option>)}<option value="exento">Exento</option><option value="no_gravado">No gravado</option></>}</Selector>}
                    {!l.articulo && <Selector etiqueta="Cuenta del gasto" value={l.cuenta} error={errLinea(l.uid, 'cuenta_id')} onChange={(e) => cambiarLinea(l.uid, { cuenta: e.target.value })}><option value="">Compras (la general)</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}</Selector>}
                    {variosDepositos && l.articulo?.controla_stock && <Selector etiqueta="Entra en" value={l.deposito || String(depositos[0].id)} error={errLinea(l.uid, 'deposito_id')} onChange={(e) => cambiarLinea(l.uid, { deposito: e.target.value })}>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector>}
                  </div>
                </div>
              ))}
              <button type="button" className="btn chico" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>+ Agregar renglón</button>
            </div>
            <div className="tarjeta">
              <h2 style={{ marginBottom: 6 }}>Percepciones e impuestos</h2>
              {tributos.length === 0 && <p className="muted" style={{ margin: '0 0 8px' }}>Si la factura trae percepciones (IVA, Ingresos Brutos, etc.), agregalas acá.</p>}
              {tributos.map((t, i) => (
                <div className="fila-acceso" key={t.uid} style={{ gridTemplateColumns: '1.4fr 1.4fr 1fr auto' }}>
                  <Selector etiqueta="Tipo" value={t.tipo} onChange={(e) => setTributos((a) => a.map((x) => (x.uid === t.uid ? { ...x, tipo: e.target.value } : x)))}>{Object.entries(TRIBUTOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
                  <Selector etiqueta="Jurisdicción" value={t.jurisdiccion} disabled={t.tipo !== 'percepcion_iibb'} error={campos[`tributos[${i}].jurisdiccion_codigo`]} onChange={(e) => setTributos((a) => a.map((x) => (x.uid === t.uid ? { ...x, jurisdiccion: e.target.value } : x)))}><option value="">{t.tipo === 'percepcion_iibb' ? 'Elegí…' : '—'}</option>{jurisdicciones.map((j) => <option key={j.codigo} value={j.codigo}>{j.nombre}</option>)}</Selector>
                  <Campo etiqueta="Importe" inputMode="decimal" value={t.importe} error={campos[`tributos[${i}].importe`]} onChange={(e) => setTributos((a) => a.map((x) => (x.uid === t.uid ? { ...x, importe: e.target.value } : x)))} />
                  <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar el tributo ${i + 1}`} onClick={() => setTributos((a) => a.filter((x) => x.uid !== t.uid))}>×</button>
                </div>
              ))}
              <button type="button" className="btn chico" onClick={() => setTributos((a) => [...a, { uid: ++contador, tipo: 'percepcion_iva', jurisdiccion: '', importe: '' }])}>+ Agregar percepción o impuesto</button>
            </div>
            <div className="tarjeta"><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
          </div>

          <aside className="tarjeta previa" aria-label="Control de la factura" aria-live="polite">
            <Campo etiqueta="Total de la factura (el que dice el papel)" inputMode="decimal" value={total} error={campos.total} onChange={(e) => setTotal(e.target.value)} />
            {!pedido && <p className="muted">Elegí un proveedor, completá el punto de venta y el número, y cargá al menos un renglón con su precio.</p>}
            {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
            {previa && (
              <div style={{ marginTop: 8 }}>
                <dl>
                  {previa.items.map((it, i) => <Fila key={i} k={`${fmtCantidad(it.cantidad)} × ${it.descripcion}${it.ingresa_stock ? ' (stock)' : ''}`} v={moneda(it.importe_renglon)} />)}
                  {previa.discrimina_iva && <Fila k="Neto gravado" v={moneda(previa.imp_neto)} />}
                  {previa.ivas.filter((x) => Number(x.importe_iva) !== 0).map((x) => <Fila key={x.alicuota} k={`IVA ${x.alicuota.replace('.', ',')} %`} v={moneda(x.importe_iva)} />)}
                  {Number(previa.imp_op_ex) > 0 && <Fila k="Exento" v={moneda(previa.imp_op_ex)} />}
                  {Number(previa.imp_trib) > 0 && <Fila k="Percepciones" v={moneda(previa.imp_trib)} />}
                </dl>
                <dl><dt className="total"><strong>Total calculado</strong></dt><dd className="total"><strong>{moneda(previa.total_calculado)}</strong></dd></dl>
                {previa.coincide ? <Alerta tipo="info">El total coincide con el de la factura.</Alerta> : <Alerta tipo="aviso">No coincide con el de la factura: diferencia de <strong>{moneda(previa.diferencia)}</strong>. Revisá precios, cantidades, IVA o percepciones.</Alerta>}
                {previa.avisos.filter((a) => !/no coincide/.test(a)).map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
              </div>
            )}
            <div className="pie-form" style={{ marginTop: 14 }}><button className="btn primario" type="submit" style={{ width: '100%' }} disabled={trabajando || !pedido || !previa || !previa.coincide || !total.trim()}>{trabajando ? 'Cargando…' : 'Cargar factura'}</button></div>
          </aside>
        </div>
      </form>
    </>
  );
}
const Fila = ({ k, v }: { k: string; v: string }) => <><dt>{k}</dt><dd>{v}</dd></>;
