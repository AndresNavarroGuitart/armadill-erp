// Conciliación bancaria: se importa el extracto del banco (se pega desde el archivo del home banking: el sistema no se conecta al banco), se lo cierra y se concilia contra los movimientos de la cuenta
// en los libros. Lo que el banco hizo y los libros no registran (comisiones, impuestos, intereses) se registra desde su línea. La pantalla arma los pedidos; el servidor valida que los dos lados sumen igual.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, llamar, obtener } from '../api';
import { aDecimal, fecha, hoyISO, moneda } from '../formato';
import type { Cuenta } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, Vacio } from '../ui';

type EstadoCuenta = { id: number; banco: string; numero_cuenta: string | null; saldo_libros: string; saldo_banco: string | null; diferencia_total: string | null; pendiente_banco: string | null; pendiente_libros: string | null; no_explicada: string | null; movimientos_pendientes: number; lineas_pendientes: number; extractos_borrador: number; extracto_hasta: string | null };
type Linea = { id: number; fecha: string; descripcion: string | null; referencia: string | null; importe: string; extracto_id: number };
type Movimiento = { id: number; fecha: string; concepto: string | null; importe: string; comprobante: string | null };
type Pendientes = { lineas: Linea[]; movimientos: Movimiento[]; sugerencias: { linea_id: number; movimiento_id: number; dif_dias: number }[] };
type Extracto = { id: number; desde: string; hasta: string; saldo_inicial: string; saldo_final: string; estado: 'borrador' | 'cerrado'; nombre_archivo: string | null; lineas: number; conciliadas: number; cierra: boolean; acciones: { cerrar: boolean; borrar: boolean } };
type Historial = { id: number; fecha: string; importe: string; lineas: number; movimientos: number };

const centavos = (x: string) => Math.round(Number(x) * 100);                       // solo para mostrar la suma de lo marcado: el servidor es el que decide si concilia
const dinero = (c: number) => moneda((c / 100).toFixed(2));

export function Conciliacion({ puedeGestionar }: { puedeGestionar: boolean }) {
  const [cuentas, setCuentas] = useState<EstadoCuenta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<EstadoCuenta | null>(null);
  const [importando, setImportando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => { obtener<{ datos: EstadoCuenta[] }>('/api/conciliacion/cuentas').then((r) => { setCuentas(r.datos); setError(null); }).catch((e) => setError(e.message)); }, [recarga]);
  if (abierta) return <VistaCuenta cuenta={abierta} puedeGestionar={puedeGestionar} onVolver={() => { setAbierta(null); setRecarga((n) => n + 1); }} />;
  return (
    <>
      <div className="herramientas"><p className="muted" style={{ margin: 0, flex: 1 }}>Compará el extracto del banco con los movimientos de cada cuenta. El extracto se carga a mano (el sistema no se conecta al banco).</p>
        {puedeGestionar && <button className="btn primario" onClick={() => setImportando(true)}>Importar extracto</button>}</div>
      {error && <Alerta>{error}</Alerta>}
      {!cuentas && !error && <Cargando />}
      {cuentas && cuentas.length === 0 && <div className="tarjeta"><Vacio titulo="No hay cuentas bancarias">Cargá una en “Cajas y bancos” para empezar a conciliar.</Vacio></div>}
      {cuentas && cuentas.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Cuenta</th><th className="num">Saldo según el banco</th><th className="num">Saldo en los libros</th><th className="num">Diferencia</th><th>Pendiente</th></tr></thead>
          <tbody>{cuentas.map((c) => (
            <tr key={c.id} className="clic" onClick={() => setAbierta(c)}>
              <td><strong>{c.banco}</strong>{c.numero_cuenta && <div className="muted">{c.numero_cuenta}</div>}{c.extracto_hasta && <div className="muted">Extracto hasta el {fecha(c.extracto_hasta)}</div>}</td>
              <td className="num">{c.saldo_banco !== null ? moneda(c.saldo_banco) : <span className="muted">Sin extracto</span>}</td><td className="num">{moneda(c.saldo_libros)}</td>
              <td className="num">{c.diferencia_total !== null ? moneda(c.diferencia_total) : '—'}</td>
              <td>{c.lineas_pendientes + c.movimientos_pendientes === 0 && c.saldo_banco !== null ? <Etiqueta tono="ok">Al día</Etiqueta> : <>{c.lineas_pendientes > 0 && <Etiqueta tono="aviso">{c.lineas_pendientes} del banco</Etiqueta>} {c.movimientos_pendientes > 0 && <Etiqueta tono="info">{c.movimientos_pendientes} de los libros</Etiqueta>} {c.extractos_borrador > 0 && <Etiqueta tono="neutro">{c.extractos_borrador} en borrador</Etiqueta>}</>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {importando && cuentas && <FormImportar cuentas={cuentas} onCerrar={() => setImportando(false)} onHecho={(c) => { setImportando(false); setRecarga((n) => n + 1); setAbierta(cuentas.find((x) => x.id === c) ?? null); }} />}
    </>
  );
}

/* ====================== una cuenta ====================== */
function VistaCuenta({ cuenta, puedeGestionar, onVolver }: { cuenta: EstadoCuenta; puedeGestionar: boolean; onVolver: () => void }) {
  const avisar = useAviso();
  const [pend, setPend] = useState<Pendientes | null>(null);
  const [extractos, setExtractos] = useState<Extracto[]>([]);
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [estado, setEstado] = useState<EstadoCuenta>(cuenta);
  const [error, setError] = useState<string | null>(null);
  const [marcL, setMarcL] = useState<Set<number>>(new Set());
  const [marcM, setMarcM] = useState<Set<number>>(new Set());
  const [registrando, setRegistrando] = useState<Linea | null>(null);
  const [importando, setImportando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const cargar = useCallback(() => {
    Promise.all([
      obtener<Pendientes>(`/api/conciliacion/cuentas/${cuenta.id}/pendientes`), obtener<{ datos: Extracto[] }>('/api/conciliacion/extractos', { cuenta_bancaria_id: cuenta.id }),
      obtener<{ datos: Historial[] }>(`/api/conciliacion/cuentas/${cuenta.id}/historial`), obtener<{ datos: EstadoCuenta[] }>('/api/conciliacion/cuentas'),
    ]).then(([p, e, h, c]) => { setPend(p); setExtractos(e.datos); setHistorial(h.datos); setEstado(c.datos.find((x) => x.id === cuenta.id) ?? cuenta); setMarcL(new Set()); setMarcM(new Set()); setError(null); }).catch((x) => setError(x.message));
  }, [cuenta]);
  useEffect(cargar, [cargar]);
  const sumaL = useMemo(() => (pend?.lineas ?? []).filter((l) => marcL.has(l.id)).reduce((s, l) => s + centavos(l.importe), 0), [pend, marcL]);
  const sumaM = useMemo(() => (pend?.movimientos ?? []).filter((m) => marcM.has(m.id)).reduce((s, m) => s + centavos(m.importe), 0), [pend, marcM]);
  const puedeConciliar = marcL.size > 0 && marcM.size > 0 && sumaL === sumaM;
  const alternar = (set: Set<number>, id: number, poner: (s: Set<number>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); poner(n); };
  async function accion(f: () => Promise<unknown>, ok: string) {
    setTrabajando(true); setError(null);
    try { await f(); avisar(ok); cargar(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  return (
    <>
      <div className="herramientas"><button className="btn" onClick={onVolver}>← Cuentas</button><h2 style={{ margin: 0, flex: 1 }}>{estado.banco}{estado.numero_cuenta ? ` · ${estado.numero_cuenta}` : ''}</h2>
        {puedeGestionar && <button className="btn" onClick={() => setImportando(true)}>Importar extracto</button>}</div>
      {error && <Alerta>{error}</Alerta>}
      <div className="tarjeta" style={{ padding: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><div className="muted">Saldo según el banco</div><strong className="num">{estado.saldo_banco !== null ? moneda(estado.saldo_banco) : '—'}</strong></div>
        <div><div className="muted">Saldo en los libros</div><strong className="num">{moneda(estado.saldo_libros)}</strong></div>
        <div><div className="muted">Diferencia</div><strong className="num">{estado.diferencia_total !== null ? moneda(estado.diferencia_total) : '—'}</strong></div>
        {estado.no_explicada !== null && Number(estado.no_explicada) !== 0 && <Alerta tipo="aviso">Queda una diferencia de {moneda(estado.no_explicada)} que no se explica con lo pendiente: revisá el saldo de apertura de la cuenta.</Alerta>}
      </div>
      {!pend && !error && <Cargando />}
      {pend && (
        <>
          <div className="herramientas" style={{ marginTop: 12 }}>
            <h3 style={{ margin: 0, flex: 1 }}>Falta conciliar</h3>
            {puedeGestionar && pend.sugerencias.length > 0 && <button className="btn" disabled={trabajando} onClick={() => void accion(() => enviar('POST', '/api/conciliacion/sugerencias/aceptar', { cuenta_bancaria_id: cuenta.id }), 'Coincidencias conciliadas.')}>Conciliar las {pend.sugerencias.length} coincidencias seguras</button>}
            {puedeGestionar && <button className="btn primario" disabled={!puedeConciliar || trabajando} onClick={() => void accion(() => enviar('POST', '/api/conciliacion/conciliar', { cuenta_bancaria_id: cuenta.id, lineas: [...marcL].map((id) => ({ id })), movimientos: [...marcM].map((id) => ({ id })) }), 'Conciliado.')}>Conciliar lo marcado</button>}
          </div>
          {(marcL.size > 0 || marcM.size > 0) && <p className="muted" style={{ margin: '0 0 8px' }}>Marcado: banco {dinero(sumaL)} · libros {dinero(sumaM)}{marcL.size > 0 && marcM.size > 0 && sumaL !== sumaM ? ' — no coinciden todavía' : ''}</p>}
          <div className="rejilla" style={{ alignItems: 'start' }}>
            <div className="ancho"><h3 style={{ margin: '0 0 6px' }}>Del extracto del banco</h3>
              {pend.lineas.length === 0 ? <div className="tarjeta"><Vacio titulo="Sin líneas pendientes">{extractos.some((e) => e.estado === 'cerrado') ? 'Todo lo del banco está conciliado.' : 'Importá y cerrá un extracto para empezar.'}</Vacio></div> : (
                <div className="tabla-caja"><table><thead><tr><th /><th>Fecha</th><th>Descripción</th><th className="num">Importe</th><th /></tr></thead>
                  <tbody>{pend.lineas.map((l) => (
                    <tr key={l.id}><td><input type="checkbox" aria-label={`Marcar ${l.descripcion ?? 'línea'} del banco`} checked={marcL.has(l.id)} onChange={() => alternar(marcL, l.id, setMarcL)} /></td><td>{fecha(l.fecha)}</td><td>{l.descripcion ?? '—'}{l.referencia && <div className="muted">{l.referencia}</div>}</td><td className="num">{moneda(l.importe)}</td>
                      <td>{puedeGestionar && <button className="btn chico" onClick={() => setRegistrando(l)}>Registrar</button>}</td></tr>))}</tbody></table></div>)}
            </div>
            <div className="ancho"><h3 style={{ margin: '0 0 6px' }}>De los libros</h3>
              {pend.movimientos.length === 0 ? <div className="tarjeta"><Vacio titulo="Sin movimientos pendientes">Todos los movimientos de la cuenta están conciliados.</Vacio></div> : (
                <div className="tabla-caja"><table><thead><tr><th /><th>Fecha</th><th>Concepto</th><th className="num">Importe</th></tr></thead>
                  <tbody>{pend.movimientos.map((m) => (
                    <tr key={m.id}><td><input type="checkbox" aria-label={`Marcar ${m.concepto ?? 'movimiento'} de los libros`} checked={marcM.has(m.id)} onChange={() => alternar(marcM, m.id, setMarcM)} /></td><td>{fecha(m.fecha)}</td><td>{m.comprobante ?? m.concepto ?? '—'}{m.comprobante && m.concepto && <div className="muted">{m.concepto}</div>}</td><td className="num">{moneda(m.importe)}</td></tr>))}</tbody></table></div>)}
            </div>
          </div>
          <h3 style={{ margin: '18px 0 6px' }}>Extractos</h3>
          {extractos.length === 0 ? <p className="muted">Todavía no importaste ningún extracto de esta cuenta.</p> : (
            <div className="tabla-caja"><table><thead><tr><th>Período</th><th className="num">Saldo inicial</th><th className="num">Saldo final</th><th>Líneas</th><th>Estado</th><th /></tr></thead>
              <tbody>{extractos.map((e) => (
                <tr key={e.id}><td>{fecha(e.desde)} a {fecha(e.hasta)}{e.nombre_archivo && <div className="muted">{e.nombre_archivo}</div>}</td><td className="num">{moneda(e.saldo_inicial)}</td><td className="num">{moneda(e.saldo_final)}</td><td>{e.conciliadas} de {e.lineas} conciliadas</td>
                  <td><Etiqueta tono={e.estado === 'cerrado' ? 'ok' : 'neutro'}>{e.estado === 'cerrado' ? 'Cerrado' : 'Borrador'}</Etiqueta>{e.estado === 'borrador' && !e.cierra && <> <Etiqueta tono="aviso">No cierra</Etiqueta></>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{puedeGestionar && e.acciones.cerrar && <button className="btn chico" disabled={trabajando} onClick={() => void accion(() => enviar('POST', `/api/conciliacion/extractos/${e.id}/cerrar`, {}), 'Extracto cerrado.')}>Cerrar</button>} {puedeGestionar && e.acciones.borrar && <button className="btn chico peligro" disabled={trabajando} onClick={() => void accion(() => llamar('DELETE', `/api/conciliacion/extractos/${e.id}`), 'Borrador borrado.')}>Borrar</button>}</td></tr>))}</tbody></table></div>)}
          {historial.length > 0 && (
            <><h3 style={{ margin: '18px 0 6px' }}>Conciliaciones hechas</h3>
              <div className="tabla-caja"><table><thead><tr><th>Fecha</th><th>Qué</th><th className="num">Importe</th><th /></tr></thead>
                <tbody>{historial.map((h) => <tr key={h.id}><td>{fecha(h.fecha)}</td><td>{h.lineas} {h.lineas === 1 ? 'línea' : 'líneas'} del banco · {h.movimientos} {h.movimientos === 1 ? 'movimiento' : 'movimientos'}</td><td className="num">{moneda(h.importe)}</td><td>{puedeGestionar && <button className="btn chico" disabled={trabajando} onClick={() => void accion(() => enviar('POST', `/api/conciliacion/${h.id}/deshacer`, {}), 'Conciliación deshecha.')}>Deshacer</button>}</td></tr>)}</tbody></table></div></>
          )}
        </>
      )}
      {registrando && <FormRegistrar linea={registrando} onCerrar={() => setRegistrando(null)} onHecho={() => { setRegistrando(null); cargar(); }} />}
      {importando && <FormImportar cuentas={[estado]} onCerrar={() => setImportando(false)} onHecho={() => { setImportando(false); cargar(); }} />}
    </>
  );
}

/* ====================== registrar lo que solo está en el banco ====================== */
function FormRegistrar({ linea, onCerrar, onHecho }: { linea: Linea; onCerrar: () => void; onHecho: () => void }) {
  const avisar = useAviso();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuenta, setCuenta] = useState('');
  const [concepto, setConcepto] = useState(linea.descripcion ?? '');
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { obtener<{ datos: Cuenta[] }>('/api/plan-cuentas', { limite: 200 }).then((r) => setCuentas(r.datos)).catch(() => setCuentas([])); }, []);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { await enviar('POST', '/api/conciliacion/movimientos', { linea_id: linea.id, cuenta_contable_id: Number(cuenta), ...(concepto.trim() ? { concepto: concepto.trim() } : {}) }); avisar('Registrado en los libros y conciliado.'); onHecho(); }
    catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['linea_id', 'cuenta_contable_id', 'concepto']);
  return (
    <Modal titulo="Registrar en los libros" onCerrar={onCerrar} ancho={520}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <p style={{ marginTop: 0 }}>El banco registró <strong>{moneda(linea.importe)}</strong> el {fecha(linea.fecha)} ({linea.descripcion ?? 'sin descripción'}) y los libros no lo tienen. Se agrega como movimiento de la cuenta, con su asiento contra la cuenta que elijas, y se concilia.</p>
        <div className="rejilla">
          <div className="ancho"><Selector etiqueta="Cuenta contable de contrapartida" value={cuenta} error={campos.cuenta_contable_id} onChange={(e) => setCuenta(e.target.value)}><option value="">Elegí…</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}</Selector></div>
          <div className="ancho"><Campo etiqueta="Concepto" value={concepto} error={campos.concepto} onChange={(e) => setConcepto(e.target.value)} /></div>
        </div>
        <p className="muted" style={{ margin: '8px 0 0' }}>{Number(linea.importe) < 0 ? 'Es una salida (comisión, impuesto, gasto): elegí la cuenta de gasto.' : 'Es una entrada (interés a favor, acreditación): elegí la cuenta de ingreso.'}</p>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !cuenta}>{trabajando ? 'Guardando…' : 'Registrar y conciliar'}</button></div>
      </form>
    </Modal>
  );
}

/* ====================== importar el extracto ====================== */
/* Lee las líneas pegadas del archivo del banco: fecha, descripción, importe (con signo) y, si hay, una referencia. Separadas por punto y coma o tabulador; la fecha puede ser dd/mm/aaaa o aaaa-mm-dd. */
function leerLineas(texto: string): { lineas: { fecha: string; descripcion: string; importe: string; referencia?: string }[]; ignoradas: number } {
  const lineas: { fecha: string; descripcion: string; importe: string; referencia?: string }[] = []; let ignoradas = 0;
  for (const cruda of texto.split(/\r?\n/)) {
    if (!cruda.trim()) continue;
    const c = cruda.split(cruda.includes('\t') ? '\t' : ';').map((x) => x.trim());
    const m = c[0].match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/), iso = c[0].match(/^\d{4}-\d{2}-\d{2}$/);
    const f = iso ? c[0] : m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    if (!f || c.length < 3) { ignoradas += 1; continue; }
    lineas.push({ fecha: f, descripcion: c[1], importe: aDecimal(c[2]), ...(c[3] ? { referencia: c[3] } : {}) });
  }
  return { lineas, ignoradas };
}

function FormImportar({ cuentas, onCerrar, onHecho }: { cuentas: { id: number; banco: string; numero_cuenta: string | null }[]; onCerrar: () => void; onHecho: (cuentaId: number) => void }) {
  const avisar = useAviso();
  const [cuenta, setCuenta] = useState(cuentas.length === 1 ? String(cuentas[0].id) : '');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState(hoyISO());
  const [inicial, setInicial] = useState('');
  const [final, setFinal] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const leidas = useMemo(() => leerLineas(texto), [texto]);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try {
      const r = await enviar<{ id: number; avisos: string[] }>('POST', '/api/conciliacion/extractos', { cuenta_bancaria_id: Number(cuenta), desde, hasta, saldo_inicial: aDecimal(inicial), saldo_final: aDecimal(final), lineas: leidas.lineas });
      avisar(r.avisos.length ? 'Extracto guardado como borrador, pero no cierra: revisá los saldos antes de cerrarlo.' : 'Extracto guardado: ya lo podés cerrar.');
      onHecho(Number(cuenta));
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['cuenta_bancaria_id', 'desde', 'hasta', 'saldo_inicial', 'saldo_final', 'lineas', ...leidas.lineas.flatMap((_, i) => ['fecha', 'importe'].map((c) => `lineas[${i}].${c}`))]);
  return (
    <Modal titulo="Importar extracto del banco" onCerrar={onCerrar} ancho={760}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Selector etiqueta="Cuenta bancaria" value={cuenta} error={campos.cuenta_bancaria_id} onChange={(e) => setCuenta(e.target.value)}><option value="">Elegí…</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.banco}{c.numero_cuenta ? ` · ${c.numero_cuenta}` : ''}</option>)}</Selector></div>
          <Campo etiqueta="Desde" type="date" value={desde} error={campos.desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} error={campos.hasta} onChange={(e) => setHasta(e.target.value)} />
          <Campo etiqueta="Saldo inicial" inputMode="decimal" value={inicial} error={campos.saldo_inicial} onChange={(e) => setInicial(e.target.value)} /><Campo etiqueta="Saldo final" inputMode="decimal" value={final} error={campos.saldo_final} onChange={(e) => setFinal(e.target.value)} />
        </div>
        <label style={{ display: 'block', marginTop: 12 }}><span className="muted">Movimientos del extracto: una línea por movimiento, con fecha, descripción e importe separados por punto y coma o tabulador. Las salidas van con signo menos.</span>
          <textarea rows={9} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'02/11/2026;Transferencia recibida;1.000,00\n02/11/2026;Comisión de mantenimiento;-35,50'} style={{ width: '100%', fontFamily: 'var(--f-mono)', marginTop: 6 }} /></label>
        <p className="muted" style={{ margin: '6px 0 0' }}>{leidas.lineas.length} {leidas.lineas.length === 1 ? 'línea leída' : 'líneas leídas'}{leidas.ignoradas > 0 ? ` · ${leidas.ignoradas} ignoradas (encabezados o filas incompletas)` : ''}. Se guarda como borrador y recién al cerrarlo la base verifica que los saldos cierren.</p>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !cuenta || !desde || !hasta || !inicial.trim() || !final.trim() || leidas.lineas.length === 0}>{trabajando ? 'Guardando…' : 'Guardar extracto'}</button></div>
      </form>
    </Modal>
  );
}
