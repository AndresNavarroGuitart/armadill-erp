// Ejercicios contables: cuánto dio cada año y su cierre. Cerrar pasa el resultado a Resultados no asignados, cierra los períodos y deja el ejercicio sin
// movimientos nuevos; reabrir lo deshace mientras el ejercicio siguiente no tenga movimientos. La pantalla muestra la previa que arma el servidor (lo que lo
// impide y lo que va a pasar): no decide nada por su cuenta.
import { useEffect, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { fecha, fechaHora, moneda } from '../formato';
import type { Ejercicio, EstadoCostoVentas, PreviaCierre } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, useAviso, Vacio } from '../ui';

/** El día anterior y el mismo día un año antes de un ejercicio: lo que sugiere el alta de uno histórico. */
const diaAntes = (iso: string) => new Date(new Date(iso + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
const anioAntes = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

export function Ejercicios() {
  const { puede } = useSesion(), puedeCerrar = puede('ejercicios.cerrar');
  const [datos, setDatos] = useState<Ejercicio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [cerrando, setCerrando] = useState<Ejercicio | null>(null);
  const [reabriendo, setReabriendo] = useState<Ejercicio | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [borrando, setBorrando] = useState<Ejercicio | null>(null);
  useEffect(() => { obtener<{ datos: Ejercicio[] }>('/api/ejercicios').then((r) => { setDatos(r.datos); setError(null); }).catch((e) => setError(e.message)); }, [recarga]);
  const hecho = () => { setCerrando(null); setReabriendo(null); setAgregando(false); setBorrando(null); setRecarga((n) => n + 1); };
  // solo el último ejercicio cerrado se puede reabrir (el servidor lo vuelve a controlar)
  const ultimoCerrado = datos?.find((e) => e.cerrado)?.id;
  return (
    <>
      <div className="cabecera"><div><h1>Ejercicios</h1><p>El resultado de cada año y su cierre. Al cerrar, la ganancia o pérdida pasa a Resultados no asignados y el año deja de aceptar movimientos.</p></div>
        <div className="acciones">{puedeCerrar && <button className="btn" onClick={() => setAgregando(true)}>Agregar ejercicio</button>}</div></div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.length === 0 && <div className="tarjeta"><Vacio titulo="Todavía no hay ejercicios" /></div>}
      {datos && datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Ejercicio</th><th>Estado</th><th className="num">Resultado</th><th className="num">Asientos</th><th>Períodos</th><th /></tr></thead>
          <tbody>{datos.map((e) => (
            <tr key={e.id}>
              <td><strong>{fecha(e.desde)} al {fecha(e.hasta)}</strong></td>
              <td>{e.cerrado ? <Etiqueta tono="neutro">Cerrado</Etiqueta> : <Etiqueta tono="ok">Abierto</Etiqueta>}{e.cerrado && e.cerrado_en && <div className="muted">{fechaHora(e.cerrado_en)}{e.cerrado_por ? ` · ${e.cerrado_por}` : ''}</div>}</td>
              <td className="num" style={{ color: Number(e.resultado) < 0 ? 'var(--bad)' : undefined }}>{moneda(e.resultado)}<div className="muted" style={{ fontFamily: 'inherit' }}>{Number(e.resultado) >= 0 ? 'ganancia' : 'pérdida'}</div></td>
              <td className="num">{e.asientos}{e.borradores > 0 && <div><Etiqueta tono="aviso">{e.borradores} en borrador</Etiqueta></div>}</td>
              <td>{e.periodos_abiertos === 0 ? 'Todos cerrados' : `${e.periodos_abiertos} de ${e.periodos} abiertos`}</td>
              <td style={{ textAlign: 'right' }}>
                {puedeCerrar && !e.cerrado && <button className="btn" onClick={() => setCerrando(e)}>Cerrar ejercicio</button>}
                {puedeCerrar && e.cerrado && e.id === ultimoCerrado && <button className="btn" onClick={() => setReabriendo(e)}>Reabrir</button>}
                {puedeCerrar && !e.cerrado && e.asientos === 0 && e.borradores === 0 && <button className="btn chico" onClick={() => setBorrando(e)}>Borrar</button>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      <CostoVentas />
      {agregando && <Alta sugerido={datos && datos.length ? { desde: anioAntes(datos[datos.length - 1].desde), hasta: diaAntes(datos[datos.length - 1].desde) } : null} onCerrar={() => setAgregando(false)} onHecho={hecho} />}
      {borrando && <Baja ejercicio={borrando} onCerrar={() => setBorrando(null)} onHecho={hecho} />}
      {cerrando && <Cierre ejercicio={cerrando} onCerrar={() => setCerrando(null)} onHecho={hecho} />}
      {reabriendo && <Reapertura ejercicio={reabriendo} onCerrar={() => setReabriendo(null)} onHecho={hecho} />}
    </>
  );
}

/** El costo de ventas automático: cada salida de mercadería asienta su costo (Costo de ventas contra Mercaderías). Lo decide cada empresa; lo asienta el servidor. */
function CostoVentas() {
  const { puede } = useSesion(), puedeConfigurar = puede('contabilidad.configurar');
  const avisar = useAviso();
  const [e, setE] = useState<EstadoCostoVentas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<EstadoCostoVentas>('/api/contabilidad/costo-ventas').then(setE).catch((x) => setError(x.message)); }, []);
  async function cambiar(activo: boolean) {
    setTrabajando(true); setError(null);
    try { setE(await enviar<EstadoCostoVentas>('PUT', '/api/contabilidad/costo-ventas', { activo })); avisar(activo ? 'Costo de ventas automático activado.' : 'Costo de ventas automático desactivado.'); }
    catch (x) { setError(x instanceof Error ? x.message : 'No se pudo cambiar.'); } finally { setTrabajando(false); }
  }
  if (!e) return error ? <Alerta>{error}</Alerta> : null;
  return (
    <div className="tarjeta" style={{ marginTop: 16 }}>
      <h3 style={{ margin: 0 }}>Costo de ventas automático {e.activo ? <Etiqueta tono="ok">Activo</Etiqueta> : <Etiqueta tono="neutro">Apagado</Etiqueta>}</h3>
      <p className="muted" style={{ margin: '6px 0 10px' }}>Cuando sale mercadería al cliente (remito de salida o factura sin remito) se asienta su costo: Costo de ventas contra Mercaderías. Si vuelve (anulación o nota de crédito con devolución) se asienta al revés, al mismo costo con el que salió. El costo es el último costo del artículo; las compras de bienes con stock pasan a Mercaderías. Lo anterior a activarlo no se reasienta.</p>
      {error && <Alerta>{error}</Alerta>}
      {e.activo && <p style={{ margin: '0 0 10px' }}>Cuentas: <strong>{e.cuenta_mercaderias?.codigo} {e.cuenta_mercaderias?.nombre}</strong> y <strong>{e.cuenta_costo_ventas?.codigo} {e.cuenta_costo_ventas?.nombre}</strong> · {e.asientos_generados} asiento{e.asientos_generados === 1 ? '' : 's'} generado{e.asientos_generados === 1 ? '' : 's'}.</p>}
      {e.articulos_sin_costo > 0 && <Alerta tipo="aviso">{e.articulos_sin_costo} artículo{e.articulos_sin_costo === 1 ? '' : 's'} con stock no tiene{e.articulos_sin_costo === 1 ? '' : 'n'} costo cargado: su salida no genera costo de ventas hasta que lo cargues (Artículos → Costo).</Alerta>}
      {!e.asientos_automaticos && <Alerta tipo="aviso">La empresa no tiene activados los asientos automáticos: sin ellos no se puede activar el costo de ventas.</Alerta>}
      {puedeConfigurar && <div className="pie-form"><button className={e.activo ? 'btn' : 'btn primario'} disabled={trabajando || (!e.activo && !e.asientos_automaticos)} onClick={() => void cambiar(!e.activo)}>{e.activo ? 'Desactivar' : 'Activar costo de ventas automático'}</button></div>}
    </div>
  );
}

function Cierre({ ejercicio, onCerrar, onHecho }: { ejercicio: Ejercicio; onCerrar: () => void; onHecho: () => void }) {
  const avisar = useAviso();
  const [p, setP] = useState<PreviaCierre | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [entiendo, setEntiendo] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<PreviaCierre>(`/api/ejercicios/${ejercicio.id}/cierre`).then(setP).catch(setError); }, [ejercicio.id]);
  async function cerrar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { await enviar('POST', `/api/ejercicios/${ejercicio.id}/cerrar`, { confirmar: true }); avisar('Ejercicio cerrado.'); onHecho(); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  return (
    <Modal titulo={`Cerrar el ejercicio ${fecha(ejercicio.desde)} al ${fecha(ejercicio.hasta)}`} onCerrar={onCerrar} ancho={620}>
      <form onSubmit={cerrar} noValidate>
        {error != null && <Alerta>{(error as Error).message}</Alerta>}
        {!p && !error && <Cargando />}
        {p && (
          <>
            {p.bloqueos.map((b) => <Alerta key={b}>{b}</Alerta>)}
            <dl className="ficha" style={{ margin: '0 0 10px' }}>
              <dt>Ingresos</dt><dd>{moneda(p.ingresos)}</dd><dt>Egresos</dt><dd>{moneda(p.egresos)}</dd>
              <dt><strong>Resultado</strong></dt><dd><strong>{moneda(p.resultado)}</strong> · {p.destino}</dd>
            </dl>
            {p.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
            <p style={{ marginBottom: 6 }}>Al cerrar:</p>
            <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
              <li>se genera un asiento de cierre al {fecha(ejercicio.hasta)} que salda {p.cuentas_a_saldar} cuenta{p.cuentas_a_saldar === 1 ? '' : 's'} de ingresos y egresos contra Resultados no asignados;</li>
              <li>se cierran todos los períodos del ejercicio: no se podrá cargar nada con fecha de esos meses;</li>
              <li>los saldos patrimoniales pasan solos al ejercicio siguiente.</li>
            </ul>
            <p className="muted" style={{ marginTop: 0 }}>Se puede reabrir mientras el ejercicio siguiente no tenga movimientos.</p>
            <label className="btn" style={{ display: 'flex', gap: 8, marginBottom: 8 }}><input type="checkbox" checked={entiendo} disabled={!p.puede_cerrar} onChange={(e) => setEntiendo(e.target.checked)} /> Revisé el resultado y quiero cerrar el ejercicio</label>
          </>
        )}
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !p?.puede_cerrar || !entiendo}>{trabajando ? 'Cerrando…' : 'Cerrar ejercicio'}</button></div>
      </form>
    </Modal>
  );
}

function Reapertura({ ejercicio, onCerrar, onHecho }: { ejercicio: Ejercicio; onCerrar: () => void; onHecho: () => void }) {
  const avisar = useAviso();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function reabrir(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { await enviar('POST', `/api/ejercicios/${ejercicio.id}/reabrir`, { motivo: motivo.trim() }); avisar('Ejercicio reabierto.'); onHecho(); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['motivo']);
  return (
    <Modal titulo={`Reabrir el ejercicio ${fecha(ejercicio.desde)} al ${fecha(ejercicio.hasta)}`} onCerrar={onCerrar} ancho={520}>
      <form onSubmit={reabrir} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <Alerta tipo="aviso">Se anula el asiento de cierre y se vuelven a abrir los períodos del ejercicio. Después hay que cerrarlo de nuevo.</Alerta>
        <Campo etiqueta="Motivo de la reapertura" value={motivo} error={campos.motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || motivo.trim().length < 3}>{trabajando ? 'Reabriendo…' : 'Reabrir ejercicio'}</button></div>
      </form>
    </Modal>
  );
}

function Alta({ sugerido, onCerrar, onHecho }: { sugerido: { desde: string; hasta: string } | null; onCerrar: () => void; onHecho: () => void }) {
  const avisar = useAviso();
  const [desde, setDesde] = useState(sugerido?.desde ?? '');
  const [hasta, setHasta] = useState(sugerido?.hasta ?? '');
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function crear(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { await enviar('POST', '/api/ejercicios', { desde, hasta }); avisar('Ejercicio creado.'); onHecho(); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['desde', 'hasta']);
  return (
    <Modal titulo="Agregar un ejercicio" onCerrar={onCerrar} ancho={500}>
      <form onSubmit={crear} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <p style={{ marginTop: 0 }}>Sirve para cargar años anteriores. Se crean sus períodos mensuales; no puede pisarse con otro ejercicio ni durar más de un año. Por defecto se propone el año anterior al más viejo.</p>
        <div className="rejilla"><Campo etiqueta="Desde" type="date" value={desde} error={campos.desde} onChange={(e) => setDesde(e.target.value)} autoFocus /><Campo etiqueta="Hasta" type="date" value={hasta} error={campos.hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !desde || !hasta}>{trabajando ? 'Creando…' : 'Crear ejercicio'}</button></div>
      </form>
    </Modal>
  );
}

function Baja({ ejercicio, onCerrar, onHecho }: { ejercicio: Ejercicio; onCerrar: () => void; onHecho: () => void }) {
  const avisar = useAviso();
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  async function borrar() {
    setTrabajando(true); setError(null);
    try { await llamar('DELETE', `/api/ejercicios/${ejercicio.id}`); avisar('Ejercicio borrado.'); onHecho(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  return (
    <Modal titulo={`Borrar el ejercicio ${fecha(ejercicio.desde)} al ${fecha(ejercicio.hasta)}`} onCerrar={onCerrar} ancho={500}>
      {error && <Alerta>{error}</Alerta>}
      <p style={{ marginTop: 0 }}>Se borran el ejercicio y sus períodos. Solo se puede si no tiene asientos, comprobantes ni cobros o pagos.</p>
      <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="button" className="btn peligro" disabled={trabajando} onClick={() => void borrar()}>{trabajando ? 'Borrando…' : 'Borrar ejercicio'}</button></div>
    </Modal>
  );
}
