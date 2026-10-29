// Detalle de un comprobante de venta y lo que se puede hacer con él: anularlo (si no tiene CAE, cobros ni notas) o emitir una nota de crédito.
// Qué se ofrece lo decide el servidor (`acciones`, con la razón cuando no se puede); la pantalla solo lo muestra y deja afuera lo que el rol no permite.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, nuevaClave, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, cantidad as fmtCantidad, fecha, fechaHora, moneda } from '../formato';
import type { ComprobanteDetalle as Detalle, PreviaNota } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, useAviso, useRetraso } from '../ui';

export const ESTADOS: Record<string, { texto: string; tono: 'ok' | 'aviso' | 'malo' | 'neutro' }> = {
  borrador: { texto: 'Borrador', tono: 'neutro' }, confirmado: { texto: 'Confirmado', tono: 'ok' }, autorizado: { texto: 'Autorizado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' },
};

/** `modo`: de venta (con notas de crédito) o de compra (solo anular). */
export function ComprobanteDetalle({ id, onCerrar, onCambio, onAbrir, modo = 'venta' }: { id: number; onCerrar: () => void; onCambio: () => void; onAbrir: (id: number) => void; modo?: 'venta' | 'compra' }) {
  const base = modo === 'compra' ? '/api/compras/facturas' : '/api/comprobantes';
  const { puede } = useSesion();
  const [c, setC] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<'anular' | 'nota' | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => { setC(null); obtener<Detalle>(`${base}/${id}`).then(setC).catch((e) => setError(e.message)); }, [id, recarga]);
  const hecho = () => { setAccion(null); setRecarga((n) => n + 1); onCambio(); };

  const puedeAnular = puede(modo === 'compra' ? 'compras.anular' : 'ventas.anular'), puedeNota = modo === 'venta' && puede('ventas.emitir');
  return (
    <>
      <Modal titulo={c ? `${c.tipo} ${c.numero_formateado ?? ''}` : 'Comprobante'} onCerrar={onCerrar} ancho={680}>
        {error && <Alerta>{error}</Alerta>}
        {!c && !error && <Cargando />}
        {c && (
          <>
            <p style={{ marginTop: 0 }}><strong>{c.cliente}</strong> · {fecha(c.fecha)} · <Etiqueta tono={ESTADOS[c.estado]?.tono ?? 'neutro'}>{ESTADOS[c.estado]?.texto ?? c.estado}</Etiqueta></p>
            {c.anulacion && <Alerta>Anulado el {fechaHora(c.anulacion.en)} por {c.anulacion.por ?? '—'}. Motivo: {c.anulacion.motivo}</Alerta>}
            {c.origen && <p style={{ margin: '0 0 8px' }}>Acredita <button className="btn chico" onClick={() => onAbrir(c.origen!.id)}>{c.origen.tipo} {c.origen.numero_formateado}</button></p>}
            {c.observaciones && c.clase === 'nota_credito' && <p className="muted" style={{ margin: '0 0 8px' }}>Motivo: {c.observaciones}</p>}
            <div className="tabla-caja">
              <table>
                <thead><tr><th>Descripción</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Importe</th>{modo === 'venta' && c.clase === 'factura' && <th className="num">Acreditado</th>}</tr></thead>
                <tbody>{c.items.map((it) => <tr key={it.id}><td>{it.descripcion}</td><td className="num">{fmtCantidad(it.cantidad)}</td><td className="num">{moneda(it.precio_unitario)}</td><td className="num">{moneda(it.importe_renglon)}</td>{modo === 'venta' && c.clase === 'factura' && <td className="num">{Number(it.acreditado) > 0 ? fmtCantidad(it.acreditado) : <span className="muted">—</span>}</td>}</tr>)}</tbody>
              </table>
            </div>
            <dl className="previa" style={{ marginTop: 12 }}>
              <dl style={{ margin: 0 }}>
                {Number(c.imp_desc_pie) > 0 && <><dt>Descuento al pie</dt><dd>-{moneda(c.imp_desc_pie)}</dd></>}
                <dt>Neto gravado</dt><dd>{moneda(c.imp_neto)}</dd>
                {c.ivas.filter((x) => Number(x.importe_iva) !== 0).map((x) => <FilaIva key={x.alicuota} alicuota={x.alicuota} importe={x.importe_iva} />)}
                {Number(c.imp_op_ex) > 0 && <><dt>Exento</dt><dd>{moneda(c.imp_op_ex)}</dd></>}
                {Number(c.imp_tot_conc) > 0 && <><dt>No gravado</dt><dd>{moneda(c.imp_tot_conc)}</dd></>}
                <dt className="total"><strong>Total</strong></dt><dd className="total"><strong>{moneda(c.imp_total)}</strong></dd>
                {c.saldo !== null && c.estado !== 'anulado' && <><dt>Saldo pendiente</dt><dd>{moneda(c.saldo)}</dd></>}
              </dl>
            </dl>
            {c.notas.length > 0 && (
              <section style={{ marginTop: 12 }}><h3 style={{ marginBottom: 6 }}>Notas de crédito</h3>
                {c.notas.map((n) => <p key={n.id} style={{ margin: '2px 0' }}><button className="btn chico" onClick={() => onAbrir(n.id)}>{n.tipo} {n.numero_formateado}</button> {moneda(n.imp_total)} <Etiqueta tono={ESTADOS[n.estado]?.tono ?? 'neutro'}>{ESTADOS[n.estado]?.texto ?? n.estado}</Etiqueta></p>)}
              </section>
            )}
            <p className="muted" style={{ marginBottom: 0 }}>{c.cae ? `CAE ${c.cae}` : 'Sin CAE: numeración interna (ARCA se conecta en un próximo paso).'}{c.asiento ? ` · Asiento ${c.asiento.estado}` : ''}</p>
            {(puedeNota || puedeAnular) && c.estado !== 'anulado' && (
              <div className="pie-form" style={{ alignItems: 'center' }}>
                {puedeNota && c.clase !== 'nota_credito' && <button className="btn" disabled={c.acciones.nota_credito !== null} title={c.acciones.nota_credito ?? undefined} onClick={() => setAccion('nota')}>Emitir nota de crédito</button>}
                {puedeAnular && <button className="btn peligro" disabled={c.acciones.anular !== null} title={c.acciones.anular ?? undefined} onClick={() => setAccion('anular')}>Anular</button>}
              </div>
            )}
            {c.estado !== 'anulado' && (c.acciones.anular || (modo === 'venta' && c.clase !== 'nota_credito' && c.acciones.nota_credito)) && (puedeAnular || puedeNota) && (
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0', textAlign: 'right' }}>{c.acciones.anular && `Anular: ${c.acciones.anular}`}{c.acciones.anular && modo === 'venta' && c.clase !== 'nota_credito' && c.acciones.nota_credito ? ' · ' : ''}{modo === 'venta' && c.clase !== 'nota_credito' && c.acciones.nota_credito ? `Nota de crédito: ${c.acciones.nota_credito}` : ''}</p>
            )}
          </>
        )}
      </Modal>
      {accion === 'anular' && c && <Anular c={c} base={base} onCerrar={() => setAccion(null)} onHecho={hecho} />}
      {accion === 'nota' && c && <Nota c={c} onCerrar={() => setAccion(null)} onHecho={(nuevoId) => { hecho(); onAbrir(nuevoId); }} />}
    </>
  );
}
const FilaIva = ({ alicuota, importe }: { alicuota: string; importe: string }) => <><dt>IVA {alicuota.replace('.', ',')} %</dt><dd>{moneda(importe)}</dd></>;

function Anular({ c, base, onCerrar, onHecho }: { c: Detalle; base: string; onCerrar: () => void; onHecho: () => void }) {
  const avisar = useAviso();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function confirmar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { await enviar('POST', `${base}/${c.id}/anular`, { motivo: motivo.trim() }); avisar(`${c.tipo} ${c.numero_formateado} ${/^(Factura|Nota)/.test(c.tipo) ? 'anulada' : 'anulado'}.`); onHecho(); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['motivo']);
  return (
    <Modal titulo={`Anular ${c.tipo} ${c.numero_formateado}`} onCerrar={onCerrar} ancho={520}>
      <form onSubmit={confirmar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <Alerta tipo="aviso">Esto no se puede deshacer. El comprobante <strong>conserva su número</strong> y queda anulado; se registra el contraasiento contable de hoy y, si había mercadería, el stock vuelve a como estaba. Si hace falta un comprobante correcto, cargalo o emitilo después.</Alerta>
        <Campo etiqueta="Motivo de la anulación" value={motivo} error={campos.motivo} placeholder="Ej.: se facturó al cliente equivocado" onChange={(e) => setMotivo(e.target.value)} autoFocus />
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>No anular</button><button type="submit" className="btn peligro" disabled={trabajando || motivo.trim().length < 3}>{trabajando ? 'Anulando…' : 'Anular definitivamente'}</button></div>
      </form>
    </Modal>
  );
}

function Nota({ c, onCerrar, onHecho }: { c: Detalle; onCerrar: () => void; onHecho: (id: number) => void }) {
  const avisar = useAviso();
  const pendientes = c.items.filter((i) => Number(i.por_acreditar) > 0);
  const [filas, setFilas] = useState(() => pendientes.map((i) => ({ id: i.id, incluir: true, cantidad: fmtCantidad(i.por_acreditar) })));
  const [motivo, setMotivo] = useState('');
  const [devolver, setDevolver] = useState(true);
  const [previa, setPrevia] = useState<PreviaNota | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const intento = useRef<{ huella: string; clave: string } | null>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};

  const cuerpo = useMemo(() => ({
    comprobante_origen_id: c.id, motivo: motivo.trim().length >= 3 ? motivo.trim() : 'Motivo pendiente', devolver_stock: devolver,
    items: filas.filter((f) => f.incluir && f.cantidad.trim()).map((f) => ({ item_id: f.id, cantidad: aDecimal(f.cantidad) })),
  }), [c.id, motivo, devolver, filas]);
  const huella = JSON.stringify(cuerpo), huellaRetrasada = useRetraso(huella, 350);
  useEffect(() => {
    if (cuerpo.items.length === 0) { setPrevia(null); setErrorPrevia(null); return; }
    if (huellaRetrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaNota>('POST', '/api/ventas/notas-credito/calcular', cuerpo, { senal: ctl.signal })
      .then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.entries(e.campos).filter(([k]) => k !== 'motivo').map(([, m]) => m)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huellaRetrasada]);

  async function emitir(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    const h = JSON.stringify(cuerpo);
    if (intento.current?.huella !== h) intento.current = { huella: h, clave: nuevaClave() };      // el mismo pedido reintentado no emite dos veces
    try { const r = await enviar<{ id: number; tipo: string; numero_formateado: string }>('POST', '/api/ventas/notas-credito', cuerpo, { claveIdempotencia: intento.current.clave }); avisar(`${r.tipo} ${r.numero_formateado} emitida.`); onHecho(r.id); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['motivo', ...filas.flatMap((_, i) => [`items[${i}].item_id`, `items[${i}].cantidad`])]);
  const indice = (id: number) => filas.filter((f) => f.incluir && f.cantidad.trim()).findIndex((f) => f.id === id);
  const errFila = (id: number) => { const i = indice(id); return i >= 0 ? campos[`items[${i}].cantidad`] ?? campos[`items[${i}].item_id`] : undefined; };
  return (
    <Modal titulo={`Nota de crédito sobre ${c.tipo} ${c.numero_formateado}`} onCerrar={onCerrar} ancho={720}>
      <form onSubmit={emitir} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <p style={{ marginTop: 0 }} className="muted">Elegí qué se acredita. Va al mismo precio, descuento e IVA de la factura, y se aplica a su saldo.</p>
        <div className="tabla-caja">
          <table>
            <thead><tr><th /><th>Renglón</th><th className="num">Facturado</th><th className="num">Por acreditar</th><th className="num">Acreditar</th></tr></thead>
            <tbody>
              {pendientes.map((it) => {
                const f = filas.find((x) => x.id === it.id)!;
                return (
                  <tr key={it.id}>
                    <td><input type="checkbox" aria-label={`Acreditar ${it.descripcion}`} checked={f.incluir} onChange={(e) => setFilas((a) => a.map((x) => (x.id === it.id ? { ...x, incluir: e.target.checked } : x)))} /></td>
                    <td>{it.descripcion}{errFila(it.id) && <div className="error" style={{ color: 'var(--bad)', fontSize: 12.5 }}>{errFila(it.id)}</div>}</td><td className="num">{fmtCantidad(it.cantidad)}</td><td className="num">{fmtCantidad(it.por_acreditar)}</td>
                    <td className="num" style={{ width: 120 }}><input aria-label={`Cantidad a acreditar de ${it.descripcion}`} inputMode="decimal" value={f.cantidad} disabled={!f.incluir} style={{ width: 100, textAlign: 'right' }} onChange={(e) => setFilas((a) => a.map((x) => (x.id === it.id ? { ...x, cantidad: e.target.value } : x)))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rejilla" style={{ marginTop: 12 }}>
          <div className="ancho"><Campo etiqueta="Motivo de la nota" value={motivo} error={campos.motivo} placeholder="Ej.: devolución de mercadería dañada" onChange={(e) => setMotivo(e.target.value)} autoFocus /></div>
          <label className="btn ancho"><input type="checkbox" checked={devolver} onChange={(e) => setDevolver(e.target.checked)} /> Devolver la mercadería al depósito de donde salió (solo vuelve lo que tenía stock)</label>
        </div>
        <div aria-live="polite" style={{ marginTop: 10 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && (
            <div className="tarjeta" style={{ padding: 12 }}>
              {previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
              <p style={{ margin: 0 }}>Nota de crédito <strong>{previa.letra}</strong> por <strong className="num">{moneda(previa.imp_total)}</strong>{Number(previa.imp_iva) > 0 && <span className="muted"> (neto {moneda(previa.imp_neto)} + IVA {moneda(previa.imp_iva)})</span>}</p>
              <p className="muted" style={{ margin: '4px 0 0' }}>Saldo de la factura hoy: {moneda(previa.saldo_factura)}{previa.items.some((i) => i.devuelve_stock) ? ' · vuelve mercadería al stock' : ''}</p>
            </div>
          )}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !previa || motivo.trim().length < 3 || !!errorPrevia}>{trabajando ? 'Emitiendo…' : 'Emitir nota de crédito'}</button></div>
      </form>
    </Modal>
  );
}
