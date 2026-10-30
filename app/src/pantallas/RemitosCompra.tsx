// Remitos de entrada: la mercadería que llegó, contra una orden de compra (lo habitual) o suelta. Al confirmarlo entra al stock del depósito; al anularlo, vuelve a salir.
// No genera deuda ni asiento: eso lo hace la factura del proveedor. La pantalla arma el pedido; el servidor valida, calcula y no deja recibir más de lo que falta.
import { useEffect, useMemo, useState } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda } from '../formato';
import type { Articulo, Deposito, OrdenCompra, OrdenCompraDetalle, Pagina, PreviaRemito, RemitoCompra, RemitoCompraDetalle, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
const ESTADO: Record<string, { texto: string; tono: 'neutro' | 'ok' | 'malo' }> = { borrador: { texto: 'Borrador', tono: 'neutro' }, confirmado: { texto: 'Recibido', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' } };

export function RemitosCompra({ ordenInicial, onConsumida }: { ordenInicial: number | null; onConsumida: () => void }) {
  const { puede } = useSesion();
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState('');
  const q = useRetraso(texto, 300);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<RemitoCompra> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [formulario, setFormulario] = useState<{ remito: RemitoCompraDetalle | null; orden: number | null } | null>(ordenInicial ? { remito: null, orden: ordenInicial } : null);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => { if (ordenInicial) onConsumida(); }, [ordenInicial, onConsumida]);
  useEffect(() => { setPagina(0); }, [estado, desde, hasta, q]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<RemitoCompra>>('/api/compras/remitos', { estado, desde, hasta, q: q.trim(), limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [estado, desde, hasta, q, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="N.º del remito del proveedor" />
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADO).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
        <div style={{ flex: 1 }} />{puede('compras.cargar') && <button className="btn primario" onClick={() => setFormulario({ remito: null, orden: null })}>Registrar recepción</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay remitos de entrada">{desde || hasta || estado || q ? 'Probá con otros filtros.' : 'Registrá la mercadería que llega: entra al stock y deja asentado lo que falta de cada orden.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Remito</th><th>Del proveedor</th><th>Fecha</th><th>Proveedor</th><th>Orden</th><th className="num">Valor</th><th>Estado</th></tr></thead>
          <tbody>{datos.datos.map((r) => (
            <tr key={r.id} className="clic" onClick={() => setAbierto(r.id)}>
              <td><strong>{r.numero_formateado}</strong></td><td>{r.numero_externo ?? <span className="muted">—</span>}</td><td>{fecha(r.fecha)}</td><td>{r.proveedor}</td><td>{r.orden?.numero_formateado ?? <span className="muted">Suelto</span>}</td><td className="num">{moneda(r.total)}</td>
              <td><Etiqueta tono={ESTADO[r.estado]?.tono ?? 'neutro'}>{ESTADO[r.estado]?.texto ?? r.estado}</Etiqueta></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {formulario && <FormRemito remito={formulario.remito} ordenInicial={formulario.orden} onCerrar={() => setFormulario(null)} onHecho={(id) => { setFormulario(null); setRecarga((n) => n + 1); setAbierto(id); }} />}
      {abierto !== null && !formulario && <Detalle id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} onModificar={(r) => { setAbierto(null); setFormulario({ remito: r, orden: r.orden?.id ?? null }); }} />}
    </>
  );
}

type Fila = { uid: number; origenId: number | null; articulo: Articulo | null; texto: string; cantidad: string; precio: string; deposito: string; mueveStock: boolean; pendiente?: string };
let contador = 0;
const filaSuelta = (): Fila => ({ uid: ++contador, origenId: null, articulo: null, texto: '', cantidad: '1', precio: '', deposito: '', mueveStock: false });

function FormRemito({ remito, ordenInicial, onCerrar, onHecho }: { remito: RemitoCompraDetalle | null; ordenInicial: number | null; onCerrar: () => void; onHecho: (id: number) => void }) {
  const avisar = useAviso();
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [ordenId, setOrdenId] = useState(ordenInicial ? String(ordenInicial) : '');
  const [orden, setOrden] = useState<OrdenCompraDetalle | null>(null);
  const [provTexto, setProvTexto] = useState(remito?.proveedor ?? '');
  const [proveedor, setProveedor] = useState<Tercero | null>(remito ? ({ id: remito.tercero_id, razon_social: remito.proveedor } as Tercero) : null);
  const [fechaR, setFechaR] = useState(remito?.fecha ?? hoyISO());
  const [numeroExterno, setNumeroExterno] = useState(remito?.numero_externo ?? '');
  const [observaciones, setObservaciones] = useState(remito?.observaciones ?? '');
  const [filas, setFilas] = useState<Fila[]>(remito && !remito.orden ? remito.items.map((i) => ({ uid: ++contador, origenId: null, articulo: i.articulo_id ? ({ id: i.articulo_id, controla_stock: i.mueve_stock } as Articulo) : null, texto: i.descripcion, cantidad: fmtCantidad(i.cantidad), precio: i.precio_unitario, deposito: i.deposito_id ? String(i.deposito_id) : '', mueveStock: i.mueve_stock })) : remito ? [] : [filaSuelta()]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [previa, setPrevia] = useState<PreviaRemito | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const conOrden = ordenId !== '';
  useEffect(() => { obtener<{ datos: Deposito[] }>('/api/depositos').then((r) => setDepositos(r.datos.filter((d) => d.activo))).catch(() => setDepositos([])); }, []);
  useEffect(() => { obtener<Pagina<OrdenCompra>>('/api/compras/ordenes', { estado: 'confirmado', pendiente: 'true', limite: 100 }).then((r) => setOrdenes(r.datos)).catch(() => setOrdenes([])); }, []);
  // al elegir la orden, los renglones son los de la orden con lo que falta recibir (o, al modificar, lo que ya tenía el borrador)
  useEffect(() => {
    if (!ordenId) { setOrden(null); return; }
    obtener<OrdenCompraDetalle>(`/api/compras/ordenes/${ordenId}`).then((o) => {
      setOrden(o);
      setFilas(o.items.filter((i) => Number(i.pendiente) > 0 || remito?.items.some((x) => x.item_origen_id === i.id)).map((i) => {
        const propio = remito?.items.find((x) => x.item_origen_id === i.id);
        return { uid: ++contador, origenId: i.id, articulo: i.articulo_id ? ({ id: i.articulo_id, controla_stock: true } as Articulo) : null, texto: i.descripcion, cantidad: propio ? fmtCantidad(propio.cantidad) : fmtCantidad(i.pendiente), precio: i.precio_unitario, deposito: propio?.deposito_id ? String(propio.deposito_id) : i.deposito_id ? String(i.deposito_id) : '', mueveStock: !!i.articulo_id, pendiente: i.pendiente };
      }));
    }).catch((e) => setError(e));
  }, [ordenId]); // eslint-disable-line react-hooks/exhaustive-deps
  const variosDepositos = depositos.length > 1;
  const pedido = useMemo(() => {
    const usadas = filas.filter((f) => (conOrden ? f.origenId : f.articulo || f.texto.trim()) && f.cantidad.trim() && Number(aDecimal(f.cantidad)) > 0);
    if (!usadas.length || (!conOrden && !proveedor)) return null;
    return {
      ...(conOrden ? { orden_id: Number(ordenId) } : { tercero_id: proveedor!.id }), fecha: fechaR, ...(numeroExterno.trim() ? { numero_externo: numeroExterno.trim() } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      items: usadas.map((f) => ({
        ...(conOrden ? { item_origen_id: f.origenId } : f.articulo ? { articulo_id: f.articulo.id } : { descripcion: f.texto.trim() }), cantidad: aDecimal(f.cantidad), ...(!conOrden && f.precio.trim() ? { precio_unitario: aDecimal(f.precio) } : {}),
        ...(variosDepositos && f.mueveStock && f.deposito ? { deposito_id: Number(f.deposito) } : {}),
      })),
    };
  }, [filas, conOrden, ordenId, proveedor, fechaR, numeroExterno, observaciones, variosDepositos]);
  const huella = JSON.stringify(pedido), retrasada = useRetraso(huella, 400);
  useEffect(() => {
    if (!pedido) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaRemito>('POST', '/api/compras/remitos/calcular', pedido, { senal: ctl.signal }).then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiar = (uid: number, c: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.uid === uid ? { ...f, ...c } : f)));
  const indice = (uid: number) => filas.filter((f) => (conOrden ? f.origenId : f.articulo || f.texto.trim()) && f.cantidad.trim() && Number(aDecimal(f.cantidad)) > 0).findIndex((f) => f.uid === uid);
  const errFila = (uid: number, c: string) => { const i = indice(uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  async function guardar(confirmar: boolean) {
    if (!pedido) return;
    setTrabajando(true); setError(null);
    try {
      const cuerpo = { ...pedido, confirmar };
      const r = remito ? await enviar<RemitoCompraDetalle>('PUT', `/api/compras/remitos/${remito.id}`, cuerpo) : await enviar<RemitoCompraDetalle>('POST', '/api/compras/remitos', cuerpo);
      avisar(confirmar ? `Remito ${r.numero_formateado} registrado: la mercadería entró al stock.` : `Borrador ${r.numero_formateado} guardado.`); onHecho(r.id);
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['orden_id', 'tercero_id', 'fecha', 'numero_externo', 'items', ...filas.flatMap((_, i) => ['item_origen_id', 'articulo_id', 'descripcion', 'cantidad', 'precio_unitario', 'deposito_id'].map((c) => `items[${i}].${c}`))]);
  return (
    <Modal titulo={remito ? `Modificar el borrador ${remito.numero_formateado}` : 'Registrar recepción de mercadería'} onCerrar={onCerrar} ancho={920}>
      <form onSubmit={(e) => { e.preventDefault(); void guardar(true); }} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Selector etiqueta="Contra la orden de compra" value={ordenId} disabled={!!remito?.orden} error={campos.orden_id} onChange={(e) => { setOrdenId(e.target.value); if (!e.target.value) setFilas([filaSuelta()]); }}>
            <option value="">Sin orden (mercadería suelta)</option>{remito?.orden && !ordenes.some((o) => o.id === remito.orden!.id) && <option value={remito.orden.id}>{remito.orden.numero_formateado}</option>}
            {ordenes.map((o) => <option key={o.id} value={o.id}>{o.numero_formateado} · {o.proveedor} · {fecha(o.fecha)} · {moneda(o.total)}</option>)}</Selector></div>
          {!conOrden && <div className="ancho"><Buscador<Tercero> etiqueta="Proveedor" texto={provTexto} placeholder="Buscá por nombre o CUIT" error={campos.tercero_id}
            onTexto={(t) => { setProvTexto(t); setProveedor(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/proveedores', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
            mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{t.tipo_documento} {t.nro_documento}</span></>} onElegir={(t) => { setProveedor(t); setProvTexto(t.razon_social); }} /></div>}
          <Campo etiqueta="Fecha en que llegó" type="date" value={fechaR} error={campos.fecha} onChange={(e) => setFechaR(e.target.value)} />
          <Campo etiqueta="N.º del remito del proveedor" value={numeroExterno} error={campos.numero_externo} placeholder="0003-00004512" onChange={(e) => setNumeroExterno(e.target.value)} />
        </div>
        {conOrden && orden && <p className="muted" style={{ margin: '10px 0 0' }}>{orden.proveedor}. Cada renglón viene con lo que falta recibir: poné lo que llegó realmente (dejá en 0 lo que no).</p>}
        <h3 style={{ margin: '16px 0 6px' }}>Qué llegó</h3>
        {filas.map((f, i) => (
          <div className="renglon renglon-compra" key={f.uid}>
            {conOrden
              ? <div><span className="muted">{i === 0 ? 'Renglón de la orden' : `Renglón ${i + 1}`}</span><div><strong>{f.texto}</strong><div className="muted">Falta recibir: {fmtCantidad(f.pendiente ?? '0')}</div></div></div>
              : <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo o descripción' : `Renglón ${i + 1}`} texto={f.texto} placeholder="Elegí un artículo o escribí una descripción" error={errFila(f.uid, 'articulo_id') ?? errFila(f.uid, 'descripcion')}
                onTexto={(t) => cambiar(f.uid, { articulo: null, texto: t, mueveStock: false })} buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
                mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.controla_stock ? 'con stock' : a.tipo}</span></>} onElegir={(a) => cambiar(f.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}`, mueveStock: a.controla_stock, ...(!f.precio.trim() && a.costo && Number(a.costo) > 0 ? { precio: String(Number(a.costo)) } : {}) })} />}
            <Campo etiqueta="Cantidad recibida" inputMode="decimal" value={f.cantidad} error={errFila(f.uid, 'cantidad') ?? errFila(f.uid, 'item_origen_id')} onChange={(e) => cambiar(f.uid, { cantidad: e.target.value })} />
            {!conOrden ? <Campo etiqueta="Precio (costo)" inputMode="decimal" value={f.precio} error={errFila(f.uid, 'precio_unitario')} onChange={(e) => cambiar(f.uid, { precio: e.target.value })} /> : <div />}
            <div />
            {!conOrden ? <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={filas.length === 1} onClick={() => setFilas((fs) => fs.filter((x) => x.uid !== f.uid))}>×</button> : <div />}
            {variosDepositos && f.mueveStock && <div className="detalle-renglon"><Selector etiqueta="Entra en" value={f.deposito} error={errFila(f.uid, 'deposito_id')} onChange={(e) => cambiar(f.uid, { deposito: e.target.value })}><option value="">Elegí…</option>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector></div>}
          </div>
        ))}
        {!conOrden && <button type="button" className="btn chico" onClick={() => setFilas((fs) => [...fs, filaSuelta()])}>+ Agregar renglón</button>}
        <div className="rejilla" style={{ marginTop: 12 }}><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
        <div aria-live="polite" style={{ marginTop: 8 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && <div className="tarjeta" style={{ padding: 12 }}><p style={{ margin: 0 }}>Valor de lo recibido (sin IVA): <strong className="num">{moneda(previa.total)}</strong></p>{previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}</div>}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn" disabled={trabajando || !previa} onClick={() => void guardar(false)}>Guardar borrador</button><button type="submit" className="btn primario" disabled={trabajando || !previa}>{trabajando ? 'Guardando…' : 'Confirmar recepción'}</button></div>
      </form>
    </Modal>
  );
}

function Detalle({ id, onCerrar, onCambio, onModificar }: { id: number; onCerrar: () => void; onCambio: () => void; onModificar: (r: RemitoCompraDetalle) => void }) {
  const { puede } = useSesion(), avisar = useAviso();
  const [r, setR] = useState<RemitoCompraDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<RemitoCompraDetalle>(`/api/compras/remitos/${id}`).then(setR).catch((e) => setError(e.message)); }, [id]);
  async function accion(f: () => Promise<RemitoCompraDetalle | null>, ok: string) {
    setTrabajando(true); setError(null);
    try { const x = await f(); avisar(ok); onCambio(); if (x) { setR(x); setAnulando(false); } else onCerrar(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  const puedeCargar = puede('compras.cargar'), puedeAnular = puede('compras.anular');
  return (
    <Modal titulo={r ? `Remito de entrada ${r.numero_formateado}` : 'Remito de entrada'} onCerrar={onCerrar} ancho={720}>
      {error && <Alerta>{error}</Alerta>}
      {!r && !error && <Cargando />}
      {r && (
        <>
          <p style={{ marginTop: 0 }}><strong>{r.proveedor}</strong> · {fecha(r.fecha)} · <Etiqueta tono={ESTADO[r.estado]?.tono ?? 'neutro'}>{ESTADO[r.estado]?.texto ?? r.estado}</Etiqueta></p>
          <dl className="ficha" style={{ margin: '0 0 8px' }}><dt>Del proveedor</dt><dd>{r.numero_externo ?? '—'}</dd><dt>Orden</dt><dd>{r.orden?.numero_formateado ?? 'Suelto (sin orden)'}</dd></dl>
          {r.observaciones && <p className="muted" style={{ whiteSpace: 'pre-line', margin: '0 0 8px' }}>{r.observaciones}</p>}
          <div className="tabla-caja"><table>
            <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Valor</th><th>Entra en</th>{r.estado === 'confirmado' && <th className="num">Facturado</th>}</tr></thead>
            <tbody>{r.items.map((i) => <tr key={i.id}><td>{i.descripcion}</td><td className="num">{fmtCantidad(i.cantidad)}</td><td className="num">{moneda(i.precio_unitario)}</td><td className="num">{moneda(i.importe)}</td><td>{i.mueve_stock ? i.deposito ?? '—' : <span className="muted">No mueve stock</span>}</td>{r.estado === 'confirmado' && <td className="num">{fmtCantidad(i.facturado)}</td>}</tr>)}</tbody>
            <tfoot><tr><td style={{ fontWeight: 600 }}>Valor (sin IVA)</td><td /><td /><td className="num" style={{ fontWeight: 600 }}>{moneda(r.total)}</td><td />{r.estado === 'confirmado' && <td />}</tr></tfoot>
          </table></div>
          {(r.facturas ?? []).length > 0 && <p className="muted" style={{ margin: '10px 0 0' }}>Facturado en: {(r.facturas ?? []).map((f) => `${f.tipo} ${f.numero_formateado}`).join(' · ')}</p>}
          {anulando && (
            <form onSubmit={(e) => { e.preventDefault(); void accion(() => enviar<RemitoCompraDetalle>('POST', `/api/compras/remitos/${id}/anular`, { motivo: motivo.trim() }), 'Remito anulado: la mercadería salió del stock.'); }} noValidate style={{ marginTop: 12 }}>
              <Alerta tipo="aviso">La mercadería que entró con este remito sale del stock, y la orden vuelve a figurar como pendiente de recibir.</Alerta>
              <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              <div className="pie-form"><button type="button" className="btn" onClick={() => setAnulando(false)}>No anular</button><button type="submit" className="btn peligro" disabled={trabajando || motivo.trim().length < 3}>Anular remito</button></div>
            </form>
          )}
          {!anulando && (
            <div className="pie-form">
              {puedeCargar && r.acciones.borrar && <button className="btn peligro" disabled={trabajando} onClick={() => void accion(async () => { await llamar('DELETE', `/api/compras/remitos/${id}`); return null; }, 'Borrador borrado.')}>Borrar</button>}
              {puedeCargar && r.acciones.modificar && <button className="btn" onClick={() => onModificar(r)}>Modificar</button>}
              {puedeCargar && r.acciones.confirmar && <button className="btn primario" disabled={trabajando} onClick={() => void accion(() => enviar<RemitoCompraDetalle>('POST', `/api/compras/remitos/${id}/confirmar`, {}), 'Remito confirmado: la mercadería entró al stock.')}>Confirmar recepción</button>}
              {puedeAnular && r.acciones.anular && <button className="btn peligro" onClick={() => setAnulando(true)}>Anular</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
