// Listas de precios: alta, cambio de nombre y orden, baja de las que nadie usa, y ajuste de precios en bloque por porcentaje con vista previa.
// Los precios se guardan solo NETOS (sin IVA) y con fecha de vigencia: un ajuste agrega precios nuevos y no pisa el historial ni lo ya emitido.
import { useEffect, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, fecha, hoyISO, moneda } from '../formato';
import type { ListaPrecio, ResultadoAjuste } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, Vacio } from '../ui';

export function Listas() {
  const { puede } = useSesion();
  const edita = puede('listas.editar');
  const [listas, setListas] = useState<ListaPrecio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [abierta, setAbierta] = useState<ListaPrecio | 'nueva' | null>(null);
  const [ajustando, setAjustando] = useState<ListaPrecio | null>(null);
  useEffect(() => { obtener<{ datos: ListaPrecio[] }>('/api/listas-precio').then((r) => { setListas(r.datos); setError(null); }).catch((e) => setError(e.message)); }, [recarga]);
  const refrescar = () => setRecarga((n) => n + 1);
  return (
    <>
      <div className="cabecera"><div><h1>Listas de precios</h1><p>Precios netos (sin IVA) por lista. Cada cliente puede tener una lista asignada.</p></div><div className="acciones">{edita && <button className="btn primario" onClick={() => setAbierta('nueva')}>Nueva lista</button>}</div></div>
      {error && <Alerta>{error}</Alerta>}
      {!listas && !error && <Cargando />}
      {listas && listas.length === 0 && <div className="tarjeta"><Vacio titulo="Todavía no hay listas">Hace falta al menos una para cargar precios.</Vacio></div>}
      {listas && listas.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Lista</th><th className="num">Orden</th><th className="num">Artículos con precio</th><th className="num">Clientes</th><th /></tr></thead>
            <tbody>
              {listas.map((l) => (
                <tr key={l.id} className={edita ? 'clic' : undefined} onClick={edita ? () => setAbierta(l) : undefined}>
                  <td><strong>{l.nombre}</strong></td><td className="num">{l.orden}</td><td className="num">{l.articulos}</td><td className="num">{l.clientes}</td>
                  <td style={{ textAlign: 'right' }}>{edita && <button className="btn chico" onClick={(e) => { e.stopPropagation(); setAjustando(l); }}>Ajustar precios</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ marginTop: 12 }}>Sin lista asignada, un cliente usa la primera de la tabla (la de menor orden).</p>
      {abierta && <FormLista lista={abierta === 'nueva' ? null : abierta} onCerrar={() => setAbierta(null)} onGuardado={() => { setAbierta(null); refrescar(); }} />}
      {ajustando && listas && <Ajuste lista={ajustando} listas={listas} onCerrar={() => setAjustando(null)} onAplicado={() => { setAjustando(null); refrescar(); }} />}
    </>
  );
}

function FormLista({ lista, onCerrar, onGuardado }: { lista: ListaPrecio | null; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState(lista?.nombre ?? '');
  const [orden, setOrden] = useState(String(lista?.orden ?? 1));
  const [error, setError] = useState<unknown>(null);
  const [confirmar, setConfirmar] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    try {
      if (!lista) await enviar('POST', '/api/listas-precio', { nombre: nombre.trim(), orden: Number(orden) });
      else { const c: Record<string, unknown> = {}; if (nombre.trim() !== lista.nombre) c.nombre = nombre.trim(); if (Number(orden) !== lista.orden) c.orden = Number(orden); if (Object.keys(c).length) await enviar('PATCH', `/api/listas-precio/${lista.id}`, c); }
      avisar('Lista guardada.'); onGuardado();
    } catch (e) { setError(e); }
  }
  async function borrar() {
    if (!lista) return; setError(null);
    try { await llamar('DELETE', `/api/listas-precio/${lista.id}`); avisar(`Se borró la lista ${lista.nombre}.`); onGuardado(); } catch (e) { setError(e); setConfirmar(false); }
  }
  const general = resumenErrores(error, ['nombre', 'orden']);
  const enUso = lista ? lista.articulos > 0 || lista.clientes > 0 : false;
  return (
    <Modal titulo={lista ? lista.nombre : 'Nueva lista'} onCerrar={onCerrar} ancho={460}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Campo etiqueta="Nombre" value={nombre} error={campos.nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></div>
          <Campo etiqueta="Orden" type="number" min={1} max={99} value={orden} error={campos.orden} ayuda="La de menor orden es la que se usa si el cliente no tiene una asignada." onChange={(e) => setOrden(e.target.value)} />
        </div>
        <div className="pie-form">
          {lista && !confirmar && <button type="button" className="btn peligro" disabled={enUso} title={enUso ? 'Tiene precios o clientes: no se puede borrar' : undefined} onClick={() => setConfirmar(true)} style={{ marginRight: 'auto' }}>Borrar</button>}
          {lista && confirmar && <><span style={{ marginRight: 'auto' }}>¿Borrar “{lista.nombre}”?</span><button type="button" className="btn peligro" onClick={borrar}>Sí, borrar</button></>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={nombre.trim().length < 2}>Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

const REDONDEOS = { centavos: 'Al centavo', entero: 'Al peso', decena: 'A la decena' } as const;
function Ajuste({ lista, listas, onCerrar, onAplicado }: { lista: ListaPrecio; listas: ListaPrecio[]; onCerrar: () => void; onAplicado: () => void }) {
  const avisar = useAviso();
  const [base, setBase] = useState(String(lista.id));
  const [porcentaje, setPorcentaje] = useState('');
  const [desde, setDesde] = useState(hoyISO());
  const [redondeo, setRedondeo] = useState<keyof typeof REDONDEOS>('centavos');
  const [previa, setPrevia] = useState<ResultadoAjuste | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const cuerpo = (simular: boolean) => ({ base_lista_id: Number(base), porcentaje: aDecimal(porcentaje), vigente_desde: desde, redondeo, simular });
  // Cualquier cambio de los datos invalida la vista previa: se aplica solo lo que se vio.
  const cambiar = (f: () => void) => { f(); setPrevia(null); setError(null); };

  async function verPrevia(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { setPrevia(await enviar<ResultadoAjuste>('POST', `/api/listas-precio/${lista.id}/ajuste`, cuerpo(true))); } catch (e) { setError(e); setPrevia(null); } finally { setTrabajando(false); }
  }
  async function aplicar() {
    setTrabajando(true); setError(null);
    try { const r = await enviar<ResultadoAjuste>('POST', `/api/listas-precio/${lista.id}/ajuste`, cuerpo(false)); avisar(`Se ${r.cambian === 1 ? 'actualizó 1 precio' : `actualizaron ${r.cambian} precios`} de ${lista.nombre}, desde el ${fecha(r.vigente_desde)}.`); onAplicado(); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['porcentaje', 'base_lista_id', 'vigente_desde', 'redondeo']);
  return (
    <Modal titulo={`Ajustar precios de ${lista.nombre}`} onCerrar={onCerrar} ancho={760}>
      <form onSubmit={verPrevia} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <Alerta tipo="info">El precio nuevo es el de la lista base (vigente a esa fecha) más o menos el porcentaje. No se pisa el historial: rige desde la fecha elegida y no cambia lo ya facturado.</Alerta>
        <div className="rejilla">
          <Selector etiqueta="Tomar como base" value={base} error={campos.base_lista_id} onChange={(e) => cambiar(() => setBase(e.target.value))}>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.id === lista.id ? ' (la misma lista)' : ''}</option>)}</Selector>
          <Campo etiqueta="Porcentaje" inputMode="decimal" value={porcentaje} error={campos.porcentaje} placeholder="Ej.: -10 o 8,5" ayuda="Negativo para bajar, positivo para subir." onChange={(e) => cambiar(() => setPorcentaje(e.target.value))} autoFocus />
          <Campo etiqueta="Rige desde" type="date" value={desde} error={campos.vigente_desde} onChange={(e) => cambiar(() => setDesde(e.target.value))} />
          <Selector etiqueta="Redondeo" value={redondeo} error={campos.redondeo} onChange={(e) => cambiar(() => setRedondeo(e.target.value as keyof typeof REDONDEOS))}>{Object.entries(REDONDEOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn" disabled={trabajando || !porcentaje.trim()}>{trabajando && !previa ? 'Calculando…' : 'Ver cómo quedaría'}</button></div>
      </form>
      {previa && (
        <section style={{ marginTop: 16 }} aria-live="polite">
          <h3>Vista previa</h3>
          <p style={{ margin: '4px 0 8px' }}>{previa.cambian === 0 ? 'Ningún precio cambiaría.' : <><strong>{previa.cambian}</strong> {previa.cambian === 1 ? 'precio cambiaría' : 'precios cambiarían'} en “{lista.nombre}”{previa.sin_cambio ? ` · ${previa.sin_cambio} ya estaban así` : ''}.</>}{previa.sin_precio_base > 0 && <span className="muted"> {previa.sin_precio_base} artículos activos no tienen precio en la lista base y no se tocan.</span>}</p>
          {previa.bajo_costo > 0 && <Alerta tipo="aviso">{previa.bajo_costo} {previa.bajo_costo === 1 ? 'artículo quedaría' : 'artículos quedarían'} con precio <strong>por debajo de su último costo</strong> (marcados abajo).</Alerta>}
          {previa.datos && previa.datos.length > 0 && (
            <div className="tabla-caja" style={{ maxHeight: 280, overflow: 'auto' }}>
              <table>
                <thead><tr><th>Artículo</th><th className="num">Base</th><th className="num">Ahora</th><th className="num">Nuevo</th><th /></tr></thead>
                <tbody>{previa.datos.map((f) => <tr key={f.articulo_id}><td><strong>{f.nombre}</strong><div className="muted">{f.codigo}</div></td><td className="num">{moneda(f.base)}</td><td className="num">{f.actual ? moneda(f.actual) : <span className="muted">sin precio</span>}</td><td className="num"><strong>{moneda(f.nuevo)}</strong></td><td>{f.bajo_costo && <Etiqueta tono="aviso">Bajo el costo</Etiqueta>}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {previa.cambian > previa.datos!.length && <p className="muted">Se muestran los primeros {previa.datos!.length}.</p>}
          <div className="pie-form"><button type="button" className="btn primario" disabled={trabajando || previa.cambian === 0} onClick={aplicar}>{trabajando ? 'Aplicando…' : `Aplicar a ${previa.cambian} ${previa.cambian === 1 ? 'precio' : 'precios'}`}</button></div>
        </section>
      )}
    </Modal>
  );
}
