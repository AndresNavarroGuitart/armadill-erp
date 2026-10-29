// Nueva factura de venta. El front NO calcula importes: manda los renglones y muestra lo que devuelve el servidor
// (vista previa en vivo con /calcular; al emitir, el servidor vuelve a calcular y verifica). La letra A/B/C también la decide el servidor.
import { useEffect, useMemo, useRef, useState } from 'react';
import { enviar, ErrorApi, nuevaClave, obtener } from '../api';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda, nombreCondicion } from '../formato';
import type { Articulo, Comprobante, Deposito, Lista, Pagina, PedidoFactura, PreviaFactura, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useRetraso } from '../ui';

type Linea = { uid: number; articulo: Articulo | null; texto: string; cantidad: string; precio: string; desc: string; deposito: string };
let contador = 0;
const nuevaLinea = (): Linea => ({ uid: ++contador, articulo: null, texto: '', cantidad: '1', precio: '', desc: '', deposito: '' });

export function NuevaFactura() {
  const [clienteTexto, setClienteTexto] = useState('');
  const [cliente, setCliente] = useState<Tercero | null>(null);
  const [listas, setListas] = useState<Lista[]>([]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([nuevaLinea()]);
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [concepto, setConcepto] = useState('1');
  const [servicio, setServicio] = useState({ desde: hoyISO(), hasta: hoyISO(), vto: hoyISO() });
  const [descPie, setDescPie] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [previa, setPrevia] = useState<PreviaFactura | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [emitida, setEmitida] = useState<Comprobante | null>(null);
  const intento = useRef<{ huella: string; clave: string } | null>(null);

  useEffect(() => { obtener<{ datos: Lista[] }>('/api/listas-precio').then((r) => setListas(r.datos)).catch(() => setListas([])); }, []);
  useEffect(() => { obtener<{ datos: Deposito[] }>('/api/ventas/depositos').then((r) => setDepositos(r.datos.filter((d) => d.activo))).catch(() => setDepositos([])); }, []);
  const variosDepositos = depositos.length > 1;   // con uno solo, el servidor lo elige; con varios hay que decir de cuál sale cada bien
  const listaId = cliente?.lista_precio_id ?? listas[0]?.id;

  /* Lo que se manda a la API: solo lo que la persona escribió. Sin precio escrito, el servidor usa el de la lista. */
  const pedido: PedidoFactura | null = useMemo(() => {
    if (!cliente) return null;
    const items = lineas.filter((l) => l.articulo && l.cantidad.trim()).map((l) => ({
      articulo_id: l.articulo!.id, cantidad: aDecimal(l.cantidad), ...(variosDepositos && l.articulo!.controla_stock ? { deposito_id: Number(l.deposito || depositos[0].id) } : {}), ...(l.precio.trim() ? { precio_unitario: aDecimal(l.precio) } : {}), ...(l.desc.trim() ? { desc_pct: aDecimal(l.desc) } : {}),
    }));
    if (items.length === 0) return null;
    return {
      tercero_id: cliente.id, fecha: fechaEmision || undefined, concepto: Number(concepto), ...(concepto !== '1' ? { fecha_servicio_desde: servicio.desde, fecha_servicio_hasta: servicio.hasta, fecha_vto_pago: servicio.vto } : {}),
      ...(descPie.trim() ? { desc_pie_pct: aDecimal(descPie) } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}), items,
    };
  }, [cliente, lineas, fechaEmision, concepto, servicio, descPie, observaciones, variosDepositos, depositos]);
  const huella = JSON.stringify(pedido);
  const huellaRetrasada = useRetraso(huella, 350);

  useEffect(() => {
    if (!pedido || huellaRetrasada !== huella) return;
    const ctl = new AbortController(); setCalculando(true);
    // La vista previa corre en el servidor: es la misma cuenta que se hará al emitir.
    fetchPrevia(pedido, ctl.signal).then((p) => { setPrevia(p); setErrorPrevia(null); }).catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${etiquetaCampo(k)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); })
      .finally(() => setCalculando(false));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huellaRetrasada]);
  useEffect(() => { if (!pedido) { setPrevia(null); setErrorPrevia(null); } }, [pedido]);

  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiarLinea = (uid: number, cambios: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...cambios } : l)));

  async function emitir() {
    if (!pedido) return;
    setEmitiendo(true); setError(null);
    const h = JSON.stringify(pedido);
    if (intento.current?.huella !== h) intento.current = { huella: h, clave: nuevaClave() };   // mismo pedido = misma clave: un reintento no emite dos veces
    try {
      setEmitida(await enviar<Comprobante>('POST', '/api/ventas/facturas', pedido, { claveIdempotencia: intento.current.clave }));
    } catch (e) { setError(e); } finally { setEmitiendo(false); }
  }
  function reiniciar() {
    setEmitida(null); setCliente(null); setClienteTexto(''); setLineas([nuevaLinea()]); setPrevia(null); setErrorPrevia(null); setError(null); setDescPie(''); setObservaciones(''); setFechaEmision(hoyISO()); setConcepto('1'); intento.current = null;
  }

  const visibles = ['tercero_id', 'fecha', 'fecha_servicio_desde', 'fecha_servicio_hasta', 'fecha_vto_pago', 'desc_pie_pct', 'observaciones', ...lineas.flatMap((_, i) => ['articulo_id', 'cantidad', 'precio_unitario', 'desc_pct', 'deposito_id'].map((c) => `items[${i}].${c}`))];
  const general = resumenErrores(error, visibles);
  const indiceDeLinea = (uid: number) => lineas.filter((l) => l.articulo && l.cantidad.trim()).findIndex((l) => l.uid === uid);   // la API numera solo los renglones completos
  const errLinea = (uid: number, c: string) => { const i = indiceDeLinea(uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  return (
    <>
      <div className="cabecera"><div><h1>Nueva factura</h1><p>Factura de venta con numeración interna. La emisión electrónica con CAE de ARCA se conecta en un próximo paso.</p></div></div>
      <div className="factura">
        <div>
          <div className="tarjeta">
            {general && <Alerta>{general}</Alerta>}
            <div className="rejilla">
              <div className="ancho">
                <Buscador<Tercero> etiqueta="Cliente" texto={clienteTexto} placeholder="Buscá por nombre o documento" autoFocus error={campos.tercero_id}
                  onTexto={(t) => { setClienteTexto(t); setCliente(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/clientes', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
                  mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{nombreCondicion(t.condicion_iva_codigo)}</span></>} onElegir={(t) => { setCliente(t); setClienteTexto(t.razon_social); }} />
                {cliente && <small className="ayuda muted">{nombreCondicion(cliente.condicion_iva_codigo)} · saldo {moneda(cliente.saldo ?? '0')}</small>}
              </div>
              <Campo etiqueta="Fecha" type="date" value={fechaEmision} error={campos.fecha} onChange={(e) => setFechaEmision(e.target.value)} />
              <Selector etiqueta="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)}><option value="1">Productos</option><option value="2">Servicios</option><option value="3">Productos y servicios</option></Selector>
              {concepto !== '1' && (
                <>
                  <Campo etiqueta="Servicio desde" type="date" value={servicio.desde} error={campos.fecha_servicio_desde} onChange={(e) => setServicio({ ...servicio, desde: e.target.value })} />
                  <Campo etiqueta="Servicio hasta" type="date" value={servicio.hasta} error={campos.fecha_servicio_hasta} onChange={(e) => setServicio({ ...servicio, hasta: e.target.value })} />
                  <Campo etiqueta="Vencimiento del pago" type="date" value={servicio.vto} error={campos.fecha_vto_pago} onChange={(e) => setServicio({ ...servicio, vto: e.target.value })} />
                </>
              )}
            </div>
          </div>
          <div className="tarjeta">
            <h2 style={{ marginBottom: 6 }}>Renglones</h2>
            {lineas.map((l, i) => (
              <div className={`renglon${variosDepositos ? ' con-deposito' : ''}`} key={l.uid}>
                <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo' : `Artículo ${i + 1}`} texto={l.texto} error={errLinea(l.uid, 'articulo_id')}
                  placeholder="Código o nombre" onTexto={(t) => cambiarLinea(l.uid, { articulo: null, texto: t })}
                  buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', lista_id: listaId, limite: 8 }).then((r) => r.datos.filter((a) => a.tipo !== 'gasto'))}
                  mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.precio_neto ? moneda(a.precio_neto) : 'sin precio'}</span></>}
                  onElegir={(a) => cambiarLinea(l.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}` })} />
                <Campo etiqueta="Cantidad" inputMode="decimal" value={l.cantidad} error={errLinea(l.uid, 'cantidad')} onChange={(e) => cambiarLinea(l.uid, { cantidad: e.target.value })} />
                <Campo etiqueta="Precio neto" inputMode="decimal" value={l.precio} placeholder={l.articulo?.precio_neto ? fmtCantidad(l.articulo.precio_neto) : 'de la lista'} error={errLinea(l.uid, 'precio_unitario')} onChange={(e) => cambiarLinea(l.uid, { precio: e.target.value })} />
                {variosDepositos && <Selector etiqueta="Sale de" value={l.articulo?.controla_stock ? (l.deposito || String(depositos[0].id)) : ''} disabled={!l.articulo?.controla_stock} error={errLinea(l.uid, 'deposito_id')} onChange={(e) => cambiarLinea(l.uid, { deposito: e.target.value })}>{l.articulo?.controla_stock ? depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>) : <option value="">—</option>}</Selector>}
                <Campo etiqueta="Desc. %" inputMode="decimal" value={l.desc} error={errLinea(l.uid, 'desc_pct')} onChange={(e) => cambiarLinea(l.uid, { desc: e.target.value })} />
                <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.uid !== l.uid))}>×</button>
              </div>
            ))}
            <button type="button" className="btn chico" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>+ Agregar renglón</button>
            {campos.items && <small className="error" style={{ color: 'var(--bad)', display: 'block', marginTop: 6 }}>{campos.items}</small>}
          </div>
          <div className="tarjeta">
            <div className="rejilla">
              <Campo etiqueta="Descuento al pie %" inputMode="decimal" value={descPie} error={campos.desc_pie_pct} onChange={(e) => setDescPie(e.target.value)} />
              <div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} error={campos.observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
            </div>
          </div>
        </div>

        <aside className="tarjeta previa" aria-label="Vista previa del comprobante" aria-live="polite">
          {!pedido && <p className="muted" style={{ margin: 0 }}>Elegí un cliente y al menos un artículo para ver el comprobante.</p>}
          {pedido && calculando && !previa && <Cargando texto="Calculando…" />}
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && <VistaPrevia p={previa} actualizando={calculando} />}
          <div className="pie-form" style={{ marginTop: 14 }}>
            <button className="btn primario" disabled={!pedido || !previa || emitiendo || calculando || !!errorPrevia} onClick={emitir} style={{ width: '100%' }}>{emitiendo ? 'Emitiendo…' : 'Emitir factura'}</button>
          </div>
        </aside>
      </div>
      {emitida && <Emitida c={emitida} onNueva={reiniciar} />}
    </>
  );
}

const fetchPrevia = (p: PedidoFactura, senal: AbortSignal) => enviar<PreviaFactura>('POST', '/api/ventas/facturas/calcular', p, { senal });
const etiquetaCampo = (k: string) => k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `).replace(/_/g, ' ');

function VistaPrevia({ p, actualizando }: { p: PreviaFactura; actualizando: boolean }) {
  return (
    <div style={{ opacity: actualizando ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="letra" aria-label={`Factura ${p.letra}`}>{p.letra}</div>
        <div><strong>Factura {p.letra}</strong><div className="muted">Pto. de venta {String(p.punto_venta).padStart(4, '0')} · {fecha(p.fecha)}</div><div className="muted">{p.cliente.razon_social}</div></div>
      </div>
      {p.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
      <dl>
        {p.items.map((it, i) => <Fila key={i} k={`${fmtCantidad(it.cantidad)} × ${it.descripcion}`} v={moneda(it.importe_renglon)} />)}
        {Number(p.imp_desc_pie) > 0 && <Fila k="Descuento al pie" v={`-${moneda(p.imp_desc_pie)}`} />}
        {p.letra !== 'C' && <Fila k="Neto gravado" v={moneda(p.imp_neto)} />}
        {p.ivas.filter((x) => p.letra !== 'C' && Number(x.importe_iva) !== 0).map((x) => <Fila key={x.alicuota} k={`IVA ${x.alicuota.replace('.', ',')} %`} v={moneda(x.importe_iva)} />)}
        {Number(p.imp_op_ex) > 0 && <Fila k="Exento" v={moneda(p.imp_op_ex)} />}
        {Number(p.imp_tot_conc) > 0 && <Fila k="No gravado" v={moneda(p.imp_tot_conc)} />}
      </dl>
      <dl><dt className="total"><strong>Total</strong></dt><dd className="total"><strong>{moneda(p.imp_total)}</strong></dd></dl>
    </div>
  );
}
const Fila = ({ k, v }: { k: string; v: string }) => <><dt>{k}</dt><dd>{v}</dd></>;

function Emitida({ c, onNueva }: { c: Comprobante; onNueva: () => void }) {
  return (
    <Modal titulo={c.repetido ? 'Esta factura ya estaba emitida' : 'Factura emitida'} onCerrar={onNueva} ancho={460}>
      <p style={{ marginTop: 0 }}><Etiqueta tono="ok">{c.estado === 'confirmado' ? 'Confirmada' : c.estado}</Etiqueta></p>
      <h2 style={{ marginBottom: 4 }}>Factura {c.letra} {c.numero_formateado}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{c.cliente} · {fecha(c.fecha)}</p>
      <p style={{ fontSize: 22, margin: '8px 0' }}><strong className="num">{moneda(c.imp_total)}</strong></p>
      <Alerta tipo="info">Todavía sin CAE: la conexión con ARCA se agrega en un próximo paso. El asiento contable ya se registró{c.items.length ? ' y, si había artículos con stock, también su movimiento' : ''}.</Alerta>
      {c.avisos?.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
      <div className="pie-form"><a className="btn" href="#/comprobantes">Ver comprobantes</a><button className="btn primario" onClick={onNueva} autoFocus>Hacer otra factura</button></div>
    </Modal>
  );
}
