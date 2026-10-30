// Remitos de salida: la mercadería que se entrega al cliente. Al confirmarlo sale del stock del depósito; al anularlo, vuelve. No genera cobro ni asiento: eso lo hace la factura,
// que puede tomar los renglones del remito (en "Nueva factura", Traer del remito) sin volver a descontar el stock. La pantalla arma el pedido; el servidor valida y controla el stock.
import { useEffect, useMemo, useState } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, hoyISO, moneda, nombreCondicion } from '../formato';
import type { Articulo, Deposito, Pagina, PreviaRemitoVenta, RemitoVenta, RemitoVentaDetalle, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

const POR_PAGINA = 25;
const ESTADO: Record<string, { texto: string; tono: 'neutro' | 'ok' | 'malo' }> = { borrador: { texto: 'Borrador', tono: 'neutro' }, confirmado: { texto: 'Entregado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' } };

export function RemitosVenta() {
  const { puede } = useSesion();
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<RemitoVenta> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [formulario, setFormulario] = useState<{ remito: RemitoVentaDetalle | null } | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => { setPagina(0); }, [estado, desde, hasta]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<RemitoVenta>>('/api/ventas/remitos', { estado, desde, hasta, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [estado, desde, hasta, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADO).map(([k, e]) => <option key={k} value={k}>{e.texto}</option>)}</Selector>
        <div style={{ flex: 1 }} />{puede('ventas.emitir') && <button className="btn primario" onClick={() => setFormulario({ remito: null })}>Registrar entrega</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay remitos de salida">{desde || hasta || estado ? 'Probá con otros filtros.' : 'Registrá la mercadería que entregás: sale del stock y después la facturás tomando los renglones del remito.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Remito</th><th>Fecha</th><th>Cliente</th><th className="num">Valor</th><th>Estado</th></tr></thead>
          <tbody>{datos.datos.map((r) => (
            <tr key={r.id} className="clic" onClick={() => setAbierto(r.id)}>
              <td><strong>{r.numero_formateado}</strong></td><td>{fecha(r.fecha)}</td><td>{r.cliente}</td><td className="num">{moneda(r.total)}</td>
              <td><Etiqueta tono={ESTADO[r.estado]?.tono ?? 'neutro'}>{ESTADO[r.estado]?.texto ?? r.estado}</Etiqueta></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {formulario && <FormRemito remito={formulario.remito} onCerrar={() => setFormulario(null)} onHecho={(id) => { setFormulario(null); setRecarga((n) => n + 1); setAbierto(id); }} />}
      {abierto !== null && !formulario && <Detalle id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} onModificar={(r) => { setAbierto(null); setFormulario({ remito: r }); }} />}
    </>
  );
}

type Fila = { uid: number; articulo: Articulo | null; texto: string; cantidad: string; precio: string; deposito: string };
let contador = 0;
const filaNueva = (): Fila => ({ uid: ++contador, articulo: null, texto: '', cantidad: '1', precio: '', deposito: '' });

function FormRemito({ remito, onCerrar, onHecho }: { remito: RemitoVentaDetalle | null; onCerrar: () => void; onHecho: (id: number) => void }) {
  const avisar = useAviso();
  const [cliTexto, setCliTexto] = useState(remito?.cliente ?? '');
  const [cliente, setCliente] = useState<Tercero | null>(remito ? ({ id: remito.tercero_id, razon_social: remito.cliente } as Tercero) : null);
  const [fechaR, setFechaR] = useState(remito?.fecha ?? hoyISO());
  const [observaciones, setObservaciones] = useState(remito?.observaciones ?? '');
  const [filas, setFilas] = useState<Fila[]>(remito ? remito.items.map((i) => ({ uid: ++contador, articulo: i.articulo_id ? ({ id: i.articulo_id, controla_stock: i.mueve_stock } as Articulo) : null, texto: i.descripcion, cantidad: fmtCantidad(i.cantidad), precio: fmtCantidad(i.precio_unitario), deposito: i.deposito_id ? String(i.deposito_id) : '' })) : [filaNueva()]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [previa, setPrevia] = useState<PreviaRemitoVenta | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<{ datos: Deposito[] }>('/api/ventas/depositos').then((r) => setDepositos(r.datos.filter((d) => d.activo))).catch(() => setDepositos([])); }, []);
  const variosDepositos = depositos.length > 1;
  const completas = (fs: Fila[]) => fs.filter((f) => f.articulo && f.cantidad.trim() && Number(aDecimal(f.cantidad)) > 0);
  const pedido = useMemo(() => {
    const usadas = completas(filas);
    if (!usadas.length || !cliente) return null;
    return {
      tercero_id: cliente.id, fecha: fechaR, ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      items: usadas.map((f) => ({ articulo_id: f.articulo!.id, cantidad: aDecimal(f.cantidad), ...(f.precio.trim() ? { precio_unitario: aDecimal(f.precio) } : {}), ...(variosDepositos && f.articulo!.controla_stock && f.deposito ? { deposito_id: Number(f.deposito) } : {}) })),
    };
  }, [filas, cliente, fechaR, observaciones, variosDepositos]);
  const huella = JSON.stringify(pedido), retrasada = useRetraso(huella, 400);
  useEffect(() => {
    if (!pedido) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaRemitoVenta>('POST', '/api/ventas/remitos/calcular', pedido, { senal: ctl.signal }).then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).map(([k, m]) => `${k.replace(/^items\[(\d+)\]\./, (_, n) => `renglón ${Number(n) + 1}, `)}: ${m}`)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cambiar = (uid: number, c: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.uid === uid ? { ...f, ...c } : f)));
  const errFila = (uid: number, c: string) => { const i = completas(filas).findIndex((f) => f.uid === uid); return i >= 0 ? campos[`items[${i}].${c}`] : undefined; };

  async function guardar(confirmar: boolean) {
    if (!pedido) return;
    setTrabajando(true); setError(null);
    try {
      const cuerpo = { ...pedido, confirmar };
      const r = remito ? await enviar<RemitoVentaDetalle>('PUT', `/api/ventas/remitos/${remito.id}`, cuerpo) : await enviar<RemitoVentaDetalle>('POST', '/api/ventas/remitos', cuerpo);
      avisar(confirmar ? `Remito ${r.numero_formateado} registrado: la mercadería salió del stock.` : `Borrador ${r.numero_formateado} guardado.`); onHecho(r.id);
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['tercero_id', 'fecha', 'items', ...filas.flatMap((_, i) => ['articulo_id', 'descripcion', 'cantidad', 'precio_unitario', 'deposito_id'].map((c) => `items[${i}].${c}`))]);
  return (
    <Modal titulo={remito ? `Modificar el borrador ${remito.numero_formateado}` : 'Registrar entrega de mercadería'} onCerrar={onCerrar} ancho={920}>
      <form onSubmit={(e) => { e.preventDefault(); void guardar(true); }} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Buscador<Tercero> etiqueta="Cliente" texto={cliTexto} placeholder="Buscá por nombre o documento" error={campos.tercero_id}
            onTexto={(t) => { setCliTexto(t); setCliente(null); }} buscar={(q) => obtener<Pagina<Tercero>>('/api/clientes', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
            mostrar={(t) => <><span>{t.razon_social}</span><span className="muted">{nombreCondicion(t.condicion_iva_codigo)}</span></>} onElegir={(t) => { setCliente(t); setCliTexto(t.razon_social); }} /></div>
          <Campo etiqueta="Fecha de entrega" type="date" value={fechaR} error={campos.fecha} onChange={(e) => setFechaR(e.target.value)} />
        </div>
        <h3 style={{ margin: '16px 0 6px' }}>Qué se entrega</h3>
        {filas.map((f, i) => (
          <div className="renglon renglon-compra" key={f.uid}>
            <Buscador<Articulo> etiqueta={i === 0 ? 'Artículo' : `Renglón ${i + 1}`} texto={f.texto} placeholder="Código o nombre" error={errFila(f.uid, 'articulo_id')}
              onTexto={(t) => cambiar(f.uid, { articulo: null, texto: t })} buscar={(q) => obtener<Pagina<Articulo>>('/api/articulos', { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos.filter((a) => a.tipo !== 'gasto'))}
              mostrar={(a) => <><span>{a.codigo} · {a.nombre}</span><span className="muted">{a.controla_stock ? 'con stock' : a.tipo}</span></>} onElegir={(a) => cambiar(f.uid, { articulo: a, texto: `${a.codigo} · ${a.nombre}` })} />
            <Campo etiqueta="Cantidad" inputMode="decimal" value={f.cantidad} error={errFila(f.uid, 'cantidad')} onChange={(e) => cambiar(f.uid, { cantidad: e.target.value })} />
            <Campo etiqueta="Precio neto" inputMode="decimal" value={f.precio} placeholder={f.articulo?.precio_neto ? fmtCantidad(f.articulo.precio_neto) : 'de la lista'} error={errFila(f.uid, 'precio_unitario')} onChange={(e) => cambiar(f.uid, { precio: e.target.value })} />
            <div />
            <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar renglón ${i + 1}`} disabled={filas.length === 1} onClick={() => setFilas((fs) => fs.filter((x) => x.uid !== f.uid))}>×</button>
            {variosDepositos && f.articulo?.controla_stock && <div className="detalle-renglon"><Selector etiqueta="Sale de" value={f.deposito || String(depositos[0].id)} error={errFila(f.uid, 'deposito_id')} onChange={(e) => cambiar(f.uid, { deposito: e.target.value })}>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector></div>}
          </div>
        ))}
        <button type="button" className="btn chico" onClick={() => setFilas((fs) => [...fs, filaNueva()])}>+ Agregar renglón</button>
        <div className="rejilla" style={{ marginTop: 12 }}><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
        <div aria-live="polite" style={{ marginTop: 8 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && <div className="tarjeta" style={{ padding: 12 }}><p style={{ margin: 0 }}>Valor de lo entregado (sin IVA): <strong className="num">{moneda(previa.total)}</strong></p>{previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}</div>}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn" disabled={trabajando || !previa} onClick={() => void guardar(false)}>Guardar borrador</button><button type="submit" className="btn primario" disabled={trabajando || !previa}>{trabajando ? 'Guardando…' : 'Confirmar entrega'}</button></div>
      </form>
    </Modal>
  );
}

function Detalle({ id, onCerrar, onCambio, onModificar }: { id: number; onCerrar: () => void; onCambio: () => void; onModificar: (r: RemitoVentaDetalle) => void }) {
  const { puede } = useSesion(), avisar = useAviso();
  const [r, setR] = useState<RemitoVentaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<RemitoVentaDetalle>(`/api/ventas/remitos/${id}`).then(setR).catch((e) => setError(e.message)); }, [id]);
  async function accion(f: () => Promise<RemitoVentaDetalle | null>, ok: string) {
    setTrabajando(true); setError(null);
    try { const x = await f(); avisar(ok); onCambio(); if (x) { setR(x); setAnulando(false); } else onCerrar(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  const puedeEmitir = puede('ventas.emitir'), puedeAnular = puede('ventas.anular');
  return (
    <Modal titulo={r ? `Remito de salida ${r.numero_formateado}` : 'Remito de salida'} onCerrar={onCerrar} ancho={720}>
      {error && <Alerta>{error}</Alerta>}
      {!r && !error && <Cargando />}
      {r && (
        <>
          <p style={{ marginTop: 0 }}><strong>{r.cliente}</strong> · {fecha(r.fecha)} · <Etiqueta tono={ESTADO[r.estado]?.tono ?? 'neutro'}>{ESTADO[r.estado]?.texto ?? r.estado}</Etiqueta></p>
          {r.observaciones && <p className="muted" style={{ whiteSpace: 'pre-line', margin: '0 0 8px' }}>{r.observaciones}</p>}
          <div className="tabla-caja"><table>
            <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Valor</th><th>Sale de</th>{r.estado === 'confirmado' && <th className="num">Facturado</th>}</tr></thead>
            <tbody>{r.items.map((i) => <tr key={i.id}><td>{i.descripcion}</td><td className="num">{fmtCantidad(i.cantidad)}</td><td className="num">{moneda(i.precio_unitario)}</td><td className="num">{moneda(i.importe)}</td><td>{i.mueve_stock ? i.deposito ?? '—' : <span className="muted">No mueve stock</span>}</td>{r.estado === 'confirmado' && <td className="num">{fmtCantidad(i.facturado)}</td>}</tr>)}</tbody>
            <tfoot><tr><td style={{ fontWeight: 600 }}>Valor (sin IVA)</td><td /><td /><td className="num" style={{ fontWeight: 600 }}>{moneda(r.total)}</td><td />{r.estado === 'confirmado' && <td />}</tr></tfoot>
          </table></div>
          {r.facturas.length > 0 && <p className="muted" style={{ margin: '10px 0 0' }}>Facturado en: {r.facturas.map((f) => `${f.tipo} ${f.numero_formateado}`).join(' · ')}</p>}
          {r.estado === 'confirmado' && r.facturas.length === 0 && <p className="muted" style={{ margin: '10px 0 0' }}>Para facturarlo, entrá a Nueva factura, elegí al cliente y usá «Traer del remito».</p>}
          {anulando && (
            <form onSubmit={(e) => { e.preventDefault(); void accion(() => enviar<RemitoVentaDetalle>('POST', `/api/ventas/remitos/${id}/anular`, { motivo: motivo.trim() }), 'Remito anulado: la mercadería volvió al stock.'); }} noValidate style={{ marginTop: 12 }}>
              <Alerta tipo="aviso">La mercadería que salió con este remito vuelve al depósito. Si ya lo facturaste, anulá primero esa factura.</Alerta>
              <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              <div className="pie-form"><button type="button" className="btn" onClick={() => setAnulando(false)}>No anular</button><button type="submit" className="btn peligro" disabled={trabajando || motivo.trim().length < 3}>Anular remito</button></div>
            </form>
          )}
          {!anulando && (
            <div className="pie-form">
              {puedeEmitir && r.acciones.borrar && <button className="btn peligro" disabled={trabajando} onClick={() => void accion(async () => { await llamar('DELETE', `/api/ventas/remitos/${id}`); return null; }, 'Borrador borrado.')}>Borrar</button>}
              {puedeEmitir && r.acciones.modificar && <button className="btn" onClick={() => onModificar(r)}>Modificar</button>}
              {puedeEmitir && r.acciones.confirmar && <button className="btn primario" disabled={trabajando} onClick={() => void accion(() => enviar<RemitoVentaDetalle>('POST', `/api/ventas/remitos/${id}/confirmar`, {}), 'Remito confirmado: la mercadería salió del stock.')}>Confirmar entrega</button>}
              {puedeAnular && r.acciones.anular && <button className="btn peligro" onClick={() => setAnulando(true)}>Anular</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
