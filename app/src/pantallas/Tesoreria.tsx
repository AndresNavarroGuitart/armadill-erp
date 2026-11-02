// Tesorería: cobros (recibos a clientes), pagos (órdenes de pago a proveedores) y cajas y bancos. La pantalla no calcula importes: arma el pedido, el servidor
// valida y devuelve el cálculo (lo imputado, lo que queda a cuenta, el saldo de cada comprobante). El servidor impone las reglas y sus mensajes se muestran tal cual.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, nuevaClave, obtener } from '../api';
import { useSesion } from '../sesion';
import { aDecimal, fecha, fechaHora, hoyISO, moneda } from '../formato';
import { Conciliacion } from './Conciliacion';
import type { Banco, Caja, Cheque, ChequeDetalle, Jurisdiccion, MovimientoTesoreria, Pagina, PagoDetalle, PagoResumen, Pendiente, PreviaPago, Regimen, ResumenCheque, Tercero } from '../tipos';
import { Alerta, Buscador, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, useRetraso, Vacio } from '../ui';

type Pestana = 'cobro' | 'pago' | 'cheques' | 'conciliacion' | 'cajas';
const POR_PAGINA = 25;
const TEXTO = { cobro: { uno: 'cobro', varios: 'Cobros', tercero: 'Cliente', terceros: 'clientes', ruta: '/api/cobros', accion: 'Registrar cobro', hecho: 'cobrado', permiso: 'cobros.registrar' }, pago: { uno: 'pago', varios: 'Pagos', tercero: 'Proveedor', terceros: 'proveedores', ruta: '/api/pagos', accion: 'Registrar pago', hecho: 'pagado', permiso: 'pagos.registrar' } } as const;
const ESTADOS: Record<string, { texto: string; tono: 'ok' | 'malo' }> = { confirmado: { texto: 'Confirmado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'malo' } };
const MEDIOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', cheque: 'Cheque' } as const;
const RETENCIONES = { iva: 'IVA', ganancias: 'Ganancias', iibb: 'Ingresos Brutos', suss: 'SUSS' } as const;
/** Suma de importes escritos (en centavos enteros, sin punto flotante) solo para sugerir un valor; el servidor valida y calcula. */
const centavos = (s: string) => { const t = aDecimal(s); const m = /^(\d+)(?:\.(\d{1,2}))?/.exec(t); return m ? BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')) : 0n; };
const aTexto = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

export function Tesoreria() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<Pestana>(puede('cobros.registrar') || !puede('pagos.registrar') ? 'cobro' : 'pago');
  return (
    <>
      <div className="cabecera"><div><h1>Tesorería</h1><p>Cobros a clientes, pagos a proveedores, y el dinero de cada caja y cuenta bancaria.</p></div></div>
      <div className="pestanas" role="tablist" aria-label="Tesorería">
        {([['cobro', 'Cobros'], ['pago', 'Pagos'], ['cheques', 'Cheques'], ['conciliacion', 'Conciliación'], ['cajas', 'Cajas y bancos']] as [Pestana, string][]).map(([k, n]) => <button key={k} role="tab" id={`tab-${k}`} aria-selected={pestana === k} aria-controls={`panel-${k}`} className="pestana" onClick={() => setPestana(k)}>{n}</button>)}
      </div>
      <div role="tabpanel" id={`panel-${pestana}`} aria-labelledby={`tab-${pestana}`}>
        {pestana === 'cajas' ? <CajasYBancos puedeAdministrar={puede('tesoreria.administrar')} /> : pestana === 'cheques' ? <Cheques puedeGestionar={puede('cheques.gestionar')} /> : pestana === 'conciliacion' ? <Conciliacion puedeGestionar={puede('conciliacion.gestionar')} /> : <Lista key={pestana} tipo={pestana} puedeRegistrar={puede(TEXTO[pestana].permiso)} />}
      </div>
    </>
  );
}

/* ====================== cobros y pagos ====================== */
function Lista({ tipo, puedeRegistrar }: { tipo: 'cobro' | 'pago'; puedeRegistrar: boolean }) {
  const t = TEXTO[tipo];
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<PagoResumen> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => { setPagina(0); }, [estado, desde, hasta]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<PagoResumen>>(t.ruta, { estado, desde, hasta, limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [t.ruta, estado, desde, hasta, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option><option value="confirmado">Confirmados</option><option value="anulado">Anulados</option></Selector>
        <div style={{ flex: 1 }} />{puedeRegistrar && <button className="btn primario" onClick={() => setNuevo(true)}>{t.accion}</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo={`No hay ${t.varios.toLowerCase()}`}>{desde || hasta || estado ? 'Probá con otro período o estado.' : puedeRegistrar ? `Usá “${t.accion}” para cargar el primero.` : undefined}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>{tipo === 'cobro' ? 'Recibo' : 'Orden de pago'}</th><th>Fecha</th><th>{t.tercero}</th><th className="num">Total</th><th className="num">Imputado</th><th className="num">A cuenta</th><th>Estado</th></tr></thead>
            <tbody>{datos.datos.map((p) => (
              <tr key={p.id} className="clic" onClick={() => setAbierto(p.id)}>
                <td><strong>{p.numero_formateado}</strong></td><td>{fecha(p.fecha)}</td><td>{p.tercero}</td><td className="num">{moneda(p.total_documento)}</td><td className="num">{moneda(p.total_imputado)}</td><td className="num">{Number(p.a_cuenta) > 0 ? moneda(p.a_cuenta) : <span className="muted">—</span>}</td>
                <td><Etiqueta tono={ESTADOS[p.estado]?.tono ?? 'ok'}>{ESTADOS[p.estado]?.texto ?? p.estado}</Etiqueta></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {nuevo && <FormPago tipo={tipo} onCerrar={() => setNuevo(false)} onHecho={(id) => { setNuevo(false); setRecarga((n) => n + 1); setAbierto(id); }} />}
      {abierto !== null && <Detalle tipo={tipo} id={abierto} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} />}
    </>
  );
}

type Medio = { uid: number; medio: keyof typeof MEDIOS; destino: string; importe: string; numero: string; banco: string; cuit: string; emision: string; pago: string; cartera: boolean; chequeId: string; echeq: boolean; echeqCodigo: string; noALaOrden: boolean; cruzado: boolean; aceptado: boolean };
const CHEQUE_VACIO = { numero: '', banco: '', cuit: '', emision: '', pago: '', cartera: false, chequeId: '', echeq: false, echeqCodigo: '', noALaOrden: false, cruzado: false, aceptado: false };
type Ret = { uid: number; tipo: keyof typeof RETENCIONES; jurisdiccion: string; importe: string; numero: string; fecha: string; regimen: string; base: string };
let contador = 0;

function FormPago({ tipo, onCerrar, onHecho }: { tipo: 'cobro' | 'pago'; onCerrar: () => void; onHecho: (id: number) => void }) {
  const t = TEXTO[tipo], avisar = useAviso();
  const [terTexto, setTerTexto] = useState('');
  const [tercero, setTercero] = useState<Tercero | null>(null);
  const [fechaP, setFechaP] = useState(hoyISO());
  const [pendientes, setPendientes] = useState<Pendiente[] | null>(null);
  const [imp, setImp] = useState<Record<number, string>>({});
  const [medios, setMedios] = useState<Medio[]>([]);
  const [rets, setRets] = useState<Ret[]>([]);
  const [descuento, setDescuento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [jurisdicciones, setJurisdicciones] = useState<Jurisdiccion[]>([]);
  const [carteraLista, setCarteraLista] = useState<Cheque[]>([]);
  const [regimenes, setRegimenes] = useState<Regimen[]>([]);
  const [previa, setPrevia] = useState<PreviaPago | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const intento = useRef<{ huella: string; clave: string } | null>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};

  useEffect(() => {
    obtener<{ datos: Caja[] }>('/api/tesoreria/cajas').then((r) => setCajas(r.datos.filter((c) => c.activa))).catch(() => setCajas([]));
    obtener<{ datos: Banco[] }>('/api/tesoreria/bancos').then((r) => setBancos(r.datos.filter((b) => b.activa))).catch(() => setBancos([]));
    if (tipo === 'pago') obtener<Pagina<Cheque>>('/api/cheques', { estado: 'en_cartera', origen: 'tercero', limite: 100 }).then((r) => setCarteraLista(r.datos)).catch(() => setCarteraLista([]));
    obtener<{ datos: Regimen[] }>('/api/tesoreria/regimenes', { activo: 'true' }).then((r) => setRegimenes(r.datos)).catch(() => setRegimenes([]));
    obtener<{ datos: Jurisdiccion[] }>('/api/catalogos/jurisdicciones').then((r) => setJurisdicciones(r.datos)).catch(() => setJurisdicciones([]));
  }, []);
  useEffect(() => {
    setImp({}); setPendientes(null); if (!tercero) return;
    obtener<{ datos: Pendiente[] }>(`${t.ruta}/pendientes`, { tercero_id: tercero.id }).then((r) => setPendientes(r.datos)).catch(() => setPendientes([]));
  }, [tercero, t.ruta]);

  const pedido = useMemo(() => {
    if (!tercero) return null;
    const imputaciones = Object.entries(imp).filter(([, v]) => v.trim()).map(([id, v]) => ({ comprobante_id: Number(id), importe: aDecimal(v) }));
    return {
      tercero_id: tercero.id, fecha: fechaP, ...(descuento.trim() ? { descuento: aDecimal(descuento) } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}), imputaciones,
      medios: medios.flatMap((m): Record<string, unknown>[] => {
        if (m.medio === 'cheque') {
          if (m.cartera) return m.chequeId ? [{ medio: 'cheque', cheque_id: Number(m.chequeId) }] : [];                  // el servidor toma el importe del cheque
          if (!m.importe.trim() && !m.numero.trim()) return [];
          return [{ medio: 'cheque', ...(m.importe.trim() ? { importe: aDecimal(m.importe) } : {}), ...(tipo === 'pago' ? { cuenta_bancaria_id: Number(m.destino) || undefined } : {}),
            cheque: { numero: m.numero.trim(), ...(tipo === 'cobro' ? { banco: m.banco.trim() } : {}), ...(m.cuit.trim() ? { cuit_librador: m.cuit.replace(/\D/g, '') } : {}), ...(m.emision ? { fecha_emision: m.emision } : {}), ...(m.pago ? { fecha_pago: m.pago } : {}),
              ...(m.echeq ? { es_echeq: true, echeq_codigo: m.echeqCodigo.trim(), ...(m.noALaOrden ? { caracter: 'no_a_la_orden' } : {}), ...(m.cruzado ? { cruzado: true } : {}), ...(tipo === 'cobro' && m.aceptado ? { aceptado: true } : {}) } : {}) } }];
        }
        return m.importe.trim() ? [{ medio: m.medio, ...(m.medio === 'transferencia' ? { cuenta_bancaria_id: Number(m.destino) || undefined } : { caja_id: Number(m.destino) || undefined }), importe: aDecimal(m.importe) }] : [];
      }),
      retenciones: rets.filter((r) => r.importe.trim()).map((r) => ({ tipo: r.tipo, ...(r.tipo === 'iibb' && r.jurisdiccion ? { jurisdiccion_codigo: Number(r.jurisdiccion) } : {}), ...(r.regimen ? { regimen_id: Number(r.regimen) } : {}), ...(r.base.trim() ? { base_imponible: aDecimal(r.base) } : {}), importe: aDecimal(r.importe), certificado_numero: r.numero.trim(), certificado_fecha: r.fecha })),
    };
  }, [tercero, tipo, fechaP, descuento, observaciones, imp, medios, rets]);
  const huella = JSON.stringify(pedido), retrasada = useRetraso(huella, 400);
  const algo = !!pedido && (pedido.medios.length > 0 || pedido.retenciones.length > 0);
  useEffect(() => {
    if (!pedido || !algo) { setPrevia(null); setErrorPrevia(null); return; }
    if (retrasada !== huella) return;
    const ctl = new AbortController();
    enviar<PreviaPago>('POST', `${t.ruta}/calcular`, pedido, { senal: ctl.signal }).then((p) => { setPrevia(p); setErrorPrevia(null); })
      .catch((e) => { if ((e as Error).name === 'AbortError') return; setPrevia(null); setErrorPrevia(e instanceof ErrorApi ? [e.message, ...Object.values(e.campos)].join(' · ') : 'No se pudo calcular.'); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrasada]);

  const imputado = Object.values(imp).reduce((s, v) => s + centavos(v), 0n);
  const cobradoEnMedios = medios.reduce((s, m) => s + centavos(m.importe), 0n) + rets.reduce((s, r) => s + centavos(r.importe), 0n) + centavos(descuento);
  const agregarMedio = () => setMedios((a) => [...a, { uid: ++contador, medio: 'efectivo', destino: String(cajas.find((c) => c.tipo !== 'tarjetas')?.id ?? ''), importe: imputado > cobradoEnMedios ? aTexto(imputado - cobradoEnMedios) : '', ...CHEQUE_VACIO }]);
  const destinos = (m: Medio) => (m.medio === 'transferencia' || m.medio === 'cheque' ? bancos.map((b) => ({ id: b.id, nombre: `${b.banco}${b.numero_cuenta ? ` · ${b.numero_cuenta}` : ''}` })) : cajas.filter((c) => (m.medio === 'tarjeta' ? c.tipo === 'tarjetas' : c.tipo !== 'tarjetas')).map((c) => ({ id: c.id, nombre: c.nombre })));
  const cambiarMedio = (uid: number, c: Partial<Medio>) => setMedios((a) => a.map((m) => {
    if (m.uid !== uid) return m; const n = { ...m, ...c };
    if (c.medio && c.medio !== m.medio) { n.destino = String(destinos(n)[0]?.id ?? ''); n.cartera = c.medio === 'cheque' && tipo === 'pago' && carteraLista.length > 0; }   // al cambiar de medio, el destino cambia de lista
    return n;
  }));

  async function registrar(ev: FormEvent) {
    ev.preventDefault(); if (!pedido) return;
    setTrabajando(true); setError(null);
    const h = JSON.stringify(pedido);
    if (intento.current?.huella !== h) intento.current = { huella: h, clave: nuevaClave() };      // mismo pedido = misma clave: un reintento no registra dos veces
    try { const r = await enviar<{ id: number; etiqueta: string }>('POST', t.ruta, pedido, { claveIdempotencia: intento.current.clave }); avisar(`${r.etiqueta} registrado.`); onHecho(r.id); } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['tercero_id', 'fecha', 'descuento', 'imputaciones', 'medios', ...pendientesIdx(imp, 'comprobante_id'), ...pendientesIdx(imp, 'importe'), ...medios.flatMap((_, i) => ['medio', 'caja_id', 'cuenta_bancaria_id', 'importe', 'cheque', 'cheque_id', 'cheque.numero', 'cheque.banco', 'cheque.cuit_librador', 'cheque.fecha_emision', 'cheque.fecha_pago'].map((c) => `medios[${i}].${c}`)), ...rets.flatMap((_, i) => ['jurisdiccion_codigo', 'importe', 'certificado_numero', 'certificado_fecha', 'regimen_id', 'base_imponible'].map((c) => `retenciones[${i}].${c}`))]);
  const idxImp = (id: number) => Object.entries(imp).filter(([, v]) => v.trim()).findIndex(([k]) => Number(k) === id);

  return (
    <Modal titulo={t.accion} onCerrar={onCerrar} ancho={900}>
      <form onSubmit={registrar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <div className="ancho"><Buscador<Tercero> etiqueta={t.tercero} texto={terTexto} placeholder="Buscá por nombre o documento" autoFocus error={campos.tercero_id}
            onTexto={(x) => { setTerTexto(x); setTercero(null); }} buscar={(q) => obtener<Pagina<Tercero>>(`/api/${t.terceros}`, { q: q || undefined, activo: 'true', limite: 8 }).then((r) => r.datos)}
            mostrar={(x) => <><span>{x.razon_social}</span><span className="muted">{x.tipo_documento} {x.nro_documento}</span></>} onElegir={(x) => { setTercero(x); setTerTexto(x.razon_social); }} /></div>
          <Campo etiqueta="Fecha" type="date" value={fechaP} error={campos.fecha} onChange={(e) => setFechaP(e.target.value)} />
        </div>

        <h3 style={{ margin: '16px 0 6px' }}>Qué {tipo === 'cobro' ? 'se cobra' : 'se paga'}</h3>
        {!tercero && <p className="muted" style={{ margin: 0 }}>Elegí el {t.tercero.toLowerCase()} para ver lo que debe.</p>}
        {tercero && !pendientes && <Cargando />}
        {pendientes && pendientes.length === 0 && <p className="muted" style={{ margin: 0 }}>No hay comprobantes pendientes: lo que {tipo === 'cobro' ? 'cobres' : 'pagues'} queda a cuenta.</p>}
        {pendientes && pendientes.length > 0 && (
          <div className="tabla-caja">
            <table>
              <thead><tr><th /><th>Comprobante</th><th>Vence</th><th className="num">Saldo</th><th className="num">{tipo === 'cobro' ? 'Cobrar' : 'Pagar'}</th></tr></thead>
              <tbody>{pendientes.map((p) => {
                const marcado = imp[p.id] !== undefined, i = idxImp(p.id), e = campos[`imputaciones[${i}].importe`] ?? campos[`imputaciones[${i}].comprobante_id`];
                return (
                  <tr key={p.id}>
                    <td><input type="checkbox" aria-label={`Imputar ${p.tipo} ${p.numero_formateado}`} checked={marcado} onChange={(ev) => setImp((a) => { const n = { ...a }; if (ev.target.checked) n[p.id] = p.saldo.replace(/\.?0+$/, '').replace(/^$/, '0'); else delete n[p.id]; return n; })} /></td>
                    <td>{p.tipo} {p.numero_formateado}<div className="muted">{fecha(p.fecha)}</div>{e && <div style={{ color: 'var(--bad)', fontSize: 12.5 }}>{e}</div>}</td><td>{p.vencimiento ? fecha(p.vencimiento) : <span className="muted">—</span>}</td><td className="num">{moneda(p.saldo)}</td>
                    <td className="num" style={{ width: 130 }}><input aria-label={`Importe a imputar a ${p.numero_formateado}`} inputMode="decimal" disabled={!marcado} value={imp[p.id] ?? ''} style={{ width: 110, textAlign: 'right' }} onChange={(ev) => setImp((a) => ({ ...a, [p.id]: ev.target.value }))} /></td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}

        <h3 style={{ margin: '16px 0 6px' }}>{tipo === 'cobro' ? 'Cómo se cobra' : 'Cómo se paga'}</h3>
        {medios.length === 0 && <p className="muted" style={{ margin: '0 0 8px' }}>Agregá al menos un medio (o una retención).</p>}
        {medios.map((m, i) => {
          const cheque = m.medio === 'cheque', k = `medios[${i}].`;
          const usados = new Set(medios.filter((x) => x.uid !== m.uid && x.cartera && x.chequeId).map((x) => x.chequeId));
          return (
            <div className="fila-acceso" key={m.uid} style={{ gridTemplateColumns: '1fr 1.6fr 1fr auto' }}>
              <Selector etiqueta="Medio" value={m.medio} error={campos[k + 'medio']} onChange={(e) => cambiarMedio(m.uid, { medio: e.target.value as keyof typeof MEDIOS })}>{Object.entries(MEDIOS).map(([key, n]) => <option key={key} value={key}>{n}</option>)}</Selector>
              {cheque && tipo === 'cobro' && <Campo etiqueta="Banco del cheque" value={m.banco} error={campos[k + 'cheque.banco']} onChange={(e) => cambiarMedio(m.uid, { banco: e.target.value })} />}
              {cheque && tipo === 'pago' && <Selector etiqueta="Cheque" value={m.cartera ? 'cartera' : 'propio'} onChange={(e) => cambiarMedio(m.uid, { cartera: e.target.value === 'cartera', chequeId: '', importe: '' })}><option value="propio">Propio (lo emite la empresa)</option><option value="cartera" disabled={carteraLista.length === 0}>De la cartera (endoso){carteraLista.length === 0 ? ' — no hay' : ''}</option></Selector>}
              {!cheque && <Selector etiqueta={m.medio === 'transferencia' ? 'Cuenta bancaria' : 'Caja'} value={m.destino} error={campos[k + 'caja_id'] ?? campos[k + 'cuenta_bancaria_id']} onChange={(e) => cambiarMedio(m.uid, { destino: e.target.value })}><option value="">Elegí…</option>{destinos(m).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector>}
              <Campo etiqueta="Importe" inputMode="decimal" value={m.importe} readOnly={m.cartera} error={campos[k + 'importe']} onChange={(e) => cambiarMedio(m.uid, { importe: e.target.value })} />
              <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar el medio ${i + 1}`} onClick={() => setMedios((a) => a.filter((x) => x.uid !== m.uid))}>×</button>
              {cheque && m.cartera && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <Selector etiqueta="Cheque de la cartera" value={m.chequeId} error={campos[k + 'cheque_id'] ?? campos[k + 'cheque']} onChange={(e) => cambiarMedio(m.uid, { chequeId: e.target.value, importe: carteraLista.find((c) => String(c.id) === e.target.value)?.importe ?? '' })}>
                    <option value="">Elegí…</option>{carteraLista.map((c) => <option key={c.id} value={c.id} disabled={usados.has(String(c.id)) || (c.es_echeq && (!c.aceptado_en || c.caracter === 'no_a_la_orden'))}>{c.es_echeq ? 'ECHEQ ' : ''}{c.numero} · {c.banco ?? ''} · {moneda(c.importe)}{c.tercero ? ` · de ${c.tercero}` : ''}{c.diferido ? ` · diferido al ${fecha(c.fecha_pago)}` : ''}{c.es_echeq && !c.aceptado_en ? ' · sin aceptar' : ''}{c.es_echeq && c.caracter === 'no_a_la_orden' ? ' · no a la orden' : ''}</option>)}
                  </Selector>
                </div>
              )}
              {cheque && !m.cartera && (
                <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                  {tipo === 'pago' && <Selector etiqueta="Cuenta bancaria" value={m.destino} error={campos[k + 'cuenta_bancaria_id']} onChange={(e) => cambiarMedio(m.uid, { destino: e.target.value })}><option value="">Elegí…</option>{destinos(m).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</Selector>}
                  <Campo etiqueta="N.º de cheque" value={m.numero} error={campos[k + 'cheque.numero']} onChange={(e) => cambiarMedio(m.uid, { numero: e.target.value })} />
                  {tipo === 'cobro' && <Campo etiqueta="CUIT del librador" inputMode="numeric" value={m.cuit} error={campos[k + 'cheque.cuit_librador']} onChange={(e) => cambiarMedio(m.uid, { cuit: e.target.value })} />}
                  <Campo etiqueta="Fecha de emisión" type="date" value={m.emision} error={campos[k + 'cheque.fecha_emision']} onChange={(e) => cambiarMedio(m.uid, { emision: e.target.value })} />
                  <Campo etiqueta="Fecha de pago (si es diferido)" type="date" value={m.pago} error={campos[k + 'cheque.fecha_pago']} onChange={(e) => cambiarMedio(m.uid, { pago: e.target.value })} />
                  <label className="btn" style={{ alignSelf: 'end' }}><input type="checkbox" checked={m.echeq} onChange={(e) => cambiarMedio(m.uid, { echeq: e.target.checked })} /> Es un ECHEQ</label>
                  {m.echeq && <>
                    <Campo etiqueta="Código del ECHEQ" value={m.echeqCodigo} error={campos[k + 'cheque.echeq_codigo'] ?? campos[k + 'cheque.es_echeq']} onChange={(e) => cambiarMedio(m.uid, { echeqCodigo: e.target.value })} />
                    <Selector etiqueta="Carácter" value={m.noALaOrden ? 'no' : 'si'} onChange={(e) => cambiarMedio(m.uid, { noALaOrden: e.target.value === 'no' })}><option value="si">A la orden</option><option value="no">No a la orden</option></Selector>
                    <label className="btn" style={{ alignSelf: 'end' }}><input type="checkbox" checked={m.cruzado} onChange={(e) => cambiarMedio(m.uid, { cruzado: e.target.checked })} /> Cruzado</label>
                    {tipo === 'cobro' && <label className="btn" style={{ alignSelf: 'end' }}><input type="checkbox" checked={m.aceptado} onChange={(e) => cambiarMedio(m.uid, { aceptado: e.target.checked })} /> Ya lo acepté</label>}
                    <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>Los datos del ECHEQ se cargan a mano: el sistema no está conectado al banco. {tipo === 'cobro' ? 'Un ECHEQ recibido no se puede depositar ni entregar hasta aceptarlo.' : ''}</p>
                  </>}
                </div>
              )}
            </div>);
        })}
        <button type="button" className="btn chico" onClick={agregarMedio}>+ Agregar medio</button>

        <h3 style={{ margin: '16px 0 6px' }}>Retenciones y descuento</h3>
        {rets.map((r, i) => (
          <div className="fila-acceso" key={r.uid} style={{ gridTemplateColumns: '1fr 1.3fr 1fr 1fr 1fr auto' }}>
            <Selector etiqueta="Retención" value={r.tipo} onChange={(e) => setRets((a) => a.map((x) => (x.uid === r.uid ? { ...x, tipo: e.target.value as keyof typeof RETENCIONES, regimen: '' } : x)))}>{Object.entries(RETENCIONES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
            <Selector etiqueta="Jurisdicción" value={r.jurisdiccion} disabled={r.tipo !== 'iibb'} error={campos[`retenciones[${i}].jurisdiccion_codigo`]} onChange={(e) => setRets((a) => a.map((x) => (x.uid === r.uid ? { ...x, jurisdiccion: e.target.value } : x)))}><option value="">{r.tipo === 'iibb' ? 'Elegí…' : '—'}</option>{jurisdicciones.map((j) => <option key={j.codigo} value={j.codigo}>{j.nombre}</option>)}</Selector>
            <Campo etiqueta="Importe" inputMode="decimal" value={r.importe} error={campos[`retenciones[${i}].importe`]} onChange={(e) => setRets((a) => a.map((x) => (x.uid === r.uid ? { ...x, importe: e.target.value } : x)))} />
            <Campo etiqueta="N.º de certificado" value={r.numero} error={campos[`retenciones[${i}].certificado_numero`]} onChange={(e) => setRets((a) => a.map((x) => (x.uid === r.uid ? { ...x, numero: e.target.value } : x)))} />
            <Campo etiqueta="Fecha del certificado" type="date" value={r.fecha} error={campos[`retenciones[${i}].certificado_fecha`]} onChange={(e) => setRets((a) => a.map((x) => (x.uid === r.uid ? { ...x, fecha: e.target.value } : x)))} />
            <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar la retención ${i + 1}`} onClick={() => setRets((a) => a.filter((x) => x.uid !== r.uid))}>×</button>
            {regimenes.some((g) => g.tipo === r.tipo) && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Selector etiqueta="Régimen" value={r.regimen} error={campos[`retenciones[${i}].regimen_id`]} onChange={(e) => setRets((a) => a.map((x) => { if (x.uid !== r.uid) return x; const g = regimenes.find((y) => String(y.id) === e.target.value); return { ...x, regimen: e.target.value, jurisdiccion: g?.jurisdiccion_codigo ? String(g.jurisdiccion_codigo) : x.jurisdiccion }; }))}>
                  <option value="">Sin régimen</option>{regimenes.filter((g) => g.tipo === r.tipo).map((g) => <option key={g.id} value={g.id}>{g.codigo_arca ? `${g.codigo_arca} · ` : ''}{g.descripcion} ({g.alicuota.replace('.', ',')} %)</option>)}</Selector>
                <Campo etiqueta="Base imponible (opcional)" inputMode="decimal" value={r.base} error={campos[`retenciones[${i}].base_imponible`]} onChange={(e) => setRets((a) => a.map((x) => (x.uid === r.uid ? { ...x, base: e.target.value } : x)))} />
              </div>
            )}
          </div>
        ))}
        <div className="acciones" style={{ alignItems: 'end' }}>
          <button type="button" className="btn chico" onClick={() => setRets((a) => [...a, { uid: ++contador, tipo: 'iva', jurisdiccion: '', importe: '', numero: '', fecha: hoyISO(), regimen: '', base: '' }])}>+ Agregar retención {tipo === 'cobro' ? 'sufrida' : 'practicada'}</button>
          <div style={{ width: 200 }}><Campo etiqueta="Descuento por pronto pago" inputMode="decimal" value={descuento} error={campos.descuento} onChange={(e) => setDescuento(e.target.value)} /></div>
        </div>

        <div aria-live="polite" style={{ marginTop: 12 }}>
          {errorPrevia && <Alerta tipo="aviso">{errorPrevia}</Alerta>}
          {previa && (
            <div className="tarjeta" style={{ padding: 12 }}>
              <p style={{ margin: 0 }}>Total del {t.uno}: <strong className="num">{moneda(previa.total_documento)}</strong>{Number(previa.total_retenciones) > 0 && <span className="muted"> (medios {moneda(previa.total_medios)} + retenciones {moneda(previa.total_retenciones)}{Number(previa.total_descuentos) > 0 ? ` + descuento ${moneda(previa.total_descuentos)}` : ''})</span>}</p>
              <p style={{ margin: '4px 0 0' }}>Imputado a comprobantes: <strong className="num">{moneda(previa.total_imputado)}</strong>{Number(previa.a_cuenta) > 0 && <> · <Etiqueta tono="info">A cuenta {moneda(previa.a_cuenta)}</Etiqueta></>}</p>
              {previa.imputaciones.map((i) => <p key={i.comprobante_id} className="muted" style={{ margin: '2px 0 0' }}>{i.comprobante}: saldo {moneda(i.saldo_antes)} → {moneda(i.saldo_despues)}</p>)}
              {previa.avisos.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
            </div>
          )}
        </div>
        <div className="rejilla" style={{ marginTop: 8 }}><div className="ancho"><Campo etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div></div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={trabajando || !previa || !!errorPrevia}>{trabajando ? 'Registrando…' : t.accion}</button></div>
      </form>
    </Modal>
  );
}
/** Los errores de imputaciones se muestran junto a su fila: acá solo se listan para no repetirlos arriba. */
const pendientesIdx = (imp: Record<number, string>, campo: string) => Object.keys(imp).map((_, i) => `imputaciones[${i}].${campo}`);

function Detalle({ tipo, id, onCerrar, onCambio }: { tipo: 'cobro' | 'pago'; id: number; onCerrar: () => void; onCambio: () => void }) {
  const t = TEXTO[tipo], { puede } = useSesion(), avisar = useAviso();
  const [p, setP] = useState<PagoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  useEffect(() => { obtener<PagoDetalle>(`${t.ruta}/${id}`).then(setP).catch((e) => setError(e.message)); }, [t.ruta, id]);
  async function anular(ev: FormEvent) {
    ev.preventDefault(); setErrorAnular(null);
    try { setP(await enviar<PagoDetalle>('POST', `${t.ruta}/${id}/anular`, { motivo: motivo.trim() })); avisar(`${p?.etiqueta} anulado.`); setAnulando(false); onCambio(); } catch (e) { setErrorAnular((e as Error).message); }
  }
  return (
    <Modal titulo={p?.etiqueta ?? (tipo === 'cobro' ? 'Recibo' : 'Orden de pago')} onCerrar={onCerrar} ancho={680}>
      {error && <Alerta>{error}</Alerta>}
      {!p && !error && <Cargando />}
      {p && (
        <>
          <p style={{ marginTop: 0 }}><strong>{p.tercero}</strong> · {fecha(p.fecha)} · <Etiqueta tono={ESTADOS[p.estado]?.tono ?? 'ok'}>{ESTADOS[p.estado]?.texto ?? p.estado}</Etiqueta></p>
          {p.anulacion && <Alerta>Anulado el {fechaHora(p.anulacion.en)} por {p.anulacion.por ?? '—'}. Motivo: {p.anulacion.motivo}</Alerta>}
          <dl className="ficha">
            <dt>Total</dt><dd><strong>{moneda(p.total_documento)}</strong></dd>
            <dt>Medios</dt><dd>{p.medios.map((m, i) => <div key={i}>{m.medio === 'cheque' ? '' : `${MEDIOS[m.medio as keyof typeof MEDIOS] ?? m.medio} · `}{m.destino} · {moneda(m.importe)}</div>)}</dd>
            {p.retenciones.length > 0 && <><dt>Retenciones</dt><dd>{p.retenciones.map((r, i) => <div key={i}>{RETENCIONES[r.tipo as keyof typeof RETENCIONES] ?? r.tipo} · certificado {r.certificado_numero} ({fecha(r.certificado_fecha)}) · {moneda(r.importe)}{r.regimen ? ` · ${r.regimen}` : ''}</div>)}</dd></>}
            {Number(p.total_descuentos) > 0 && <><dt>Descuento</dt><dd>{moneda(p.total_descuentos)}</dd></>}
            <dt>Imputado a</dt><dd>{p.imputaciones.length ? p.imputaciones.map((x) => <div key={x.comprobante_id}>{x.comprobante} · {moneda(x.importe)}</div>) : <span className="muted">Nada: todo a cuenta</span>}</dd>
            {Number(p.a_cuenta) > 0 && <><dt>A cuenta</dt><dd>{moneda(p.a_cuenta)}</dd></>}
            {p.observaciones && <><dt>Observaciones</dt><dd>{p.observaciones}</dd></>}
          </dl>
          <p className="muted" style={{ marginBottom: 0 }}>{p.asiento ? `Asiento ${p.asiento.estado}` : ''}</p>
          {puede('tesoreria.anular') && p.estado === 'confirmado' && !anulando && <div className="pie-form"><button className="btn peligro" onClick={() => setAnulando(true)}>Anular</button></div>}
          {anulando && (
            <form onSubmit={anular} noValidate style={{ marginTop: 12 }}>
              {errorAnular && <Alerta>{errorAnular}</Alerta>}
              <Alerta tipo="aviso">Esto no se puede deshacer: se contrarresta el asiento, {tipo === 'cobro' ? 'sale el dinero de la caja o la cuenta' : 'vuelve el dinero a la caja o la cuenta'} y los comprobantes recuperan su saldo. El número se conserva.</Alerta>
              <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              <div className="pie-form"><button type="button" className="btn" onClick={() => setAnulando(false)}>No anular</button><button type="submit" className="btn peligro" disabled={motivo.trim().length < 3}>Anular definitivamente</button></div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}

/* ====================== cajas y bancos ====================== */
function CajasYBancos({ puedeAdministrar }: { puedeAdministrar: boolean }) {
  const [cajas, setCajas] = useState<Caja[] | null>(null);
  const [bancos, setBancos] = useState<Banco[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [formCaja, setFormCaja] = useState<Caja | 'nueva' | null>(null);
  const [formBanco, setFormBanco] = useState<Banco | 'nueva' | null>(null);
  const [regimenes, setRegimenes] = useState<Regimen[] | null>(null);
  const [formRegimen, setFormRegimen] = useState<Regimen | 'nuevo' | null>(null);
  const [movs, setMovs] = useState<{ titulo: string; filtro: Record<string, number> } | null>(null);
  useEffect(() => {
    Promise.all([obtener<{ datos: Caja[] }>('/api/tesoreria/cajas'), obtener<{ datos: Banco[] }>('/api/tesoreria/bancos'), obtener<{ datos: Regimen[] }>('/api/tesoreria/regimenes')]).then(([c, b, g]) => { setCajas(c.datos); setBancos(b.datos); setRegimenes(g.datos); setError(null); }).catch((e) => setError(e.message));
  }, [recarga]);
  const refrescar = () => setRecarga((n) => n + 1);
  return (
    <>
      {error && <Alerta>{error}</Alerta>}
      {(!cajas || !bancos) && !error && <Cargando />}
      {cajas && bancos && (
        <>
          <div className="herramientas"><h2 style={{ margin: 0, flex: 1 }}>Cajas</h2>{puedeAdministrar && <button className="btn" onClick={() => setFormCaja('nueva')}>Nueva caja</button>}</div>
          <div className="tabla-caja"><table>
            <thead><tr><th>Caja</th><th>Tipo</th><th>Cuenta contable</th><th className="num">Saldo</th><th /></tr></thead>
            <tbody>{cajas.map((c) => <tr key={c.id} className="clic" onClick={() => setMovs({ titulo: `Movimientos de ${c.nombre}`, filtro: { caja_id: c.id } })}><td><strong>{c.nombre}</strong></td><td>{c.tipo === 'tarjetas' ? 'Tarjetas' : c.tipo === 'otra' ? 'Otra' : 'Efectivo'}</td><td>{c.cuenta_codigo ?? '—'}</td><td className="num">{moneda(c.saldo)}</td>
              <td style={{ textAlign: 'right' }}>{!c.activa && <Etiqueta tono="aviso">De baja</Etiqueta>} {puedeAdministrar && <button className="btn chico" onClick={(e) => { e.stopPropagation(); setFormCaja(c); }}>Editar</button>}</td></tr>)}</tbody>
          </table></div>
          <div className="herramientas" style={{ marginTop: 22 }}><h2 style={{ margin: 0, flex: 1 }}>Cuentas bancarias</h2>{puedeAdministrar && <button className="btn" onClick={() => setFormBanco('nueva')}>Nueva cuenta</button>}</div>
          {bancos.length === 0 ? <div className="tarjeta"><Vacio titulo="Todavía no hay cuentas bancarias">{puedeAdministrar ? 'Cargá una para cobrar y pagar por transferencia.' : undefined}</Vacio></div> : (
            <div className="tabla-caja"><table>
              <thead><tr><th>Banco</th><th>Cuenta</th><th>CBU / alias</th><th className="num">Saldo</th><th /></tr></thead>
              <tbody>{bancos.map((b) => <tr key={b.id} className="clic" onClick={() => setMovs({ titulo: `Movimientos de ${b.banco}`, filtro: { cuenta_bancaria_id: b.id } })}><td><strong>{b.banco}</strong></td><td>{b.numero_cuenta ?? '—'}</td><td>{b.cbu ?? '—'}{b.alias && <div className="muted">{b.alias}</div>}</td><td className="num">{moneda(b.saldo)}</td>
                <td style={{ textAlign: 'right' }}>{!b.activa && <Etiqueta tono="aviso">De baja</Etiqueta>} {puedeAdministrar && <button className="btn chico" onClick={(e) => { e.stopPropagation(); setFormBanco(b); }}>Editar</button>}</td></tr>)}</tbody>
            </table></div>)}
        </>
      )}
      {formCaja && <FormCaja caja={formCaja === 'nueva' ? null : formCaja} onCerrar={() => setFormCaja(null)} onGuardado={() => { setFormCaja(null); refrescar(); }} />}
      {regimenes && (
        <>
          <div className="herramientas" style={{ marginTop: 22 }}><h2 style={{ margin: 0, flex: 1 }}>Regímenes de retención</h2>{puedeAdministrar && <button className="btn" onClick={() => setFormRegimen('nuevo')}>Nuevo régimen</button>}</div>
          {regimenes.length === 0 ? <div className="tarjeta"><Vacio titulo="Todavía no hay regímenes cargados">Cargá los que usás (con el código de tu aplicativo) para elegirlos al registrar una retención y que queden en los informes.</Vacio></div> : (
            <div className="tabla-caja"><table>
              <thead><tr><th>Impuesto</th><th>Código</th><th>Descripción</th><th className="num">Alícuota</th><th /></tr></thead>
              <tbody>{regimenes.map((g) => <tr key={g.id}><td>{RETENCIONES[g.tipo as keyof typeof RETENCIONES] ?? g.tipo}{g.jurisdiccion && <div className="muted">{g.jurisdiccion}</div>}</td><td>{g.codigo_arca ?? '—'}</td><td>{g.descripcion}</td><td className="num">{g.alicuota.replace('.', ',')} %</td>
                <td style={{ textAlign: 'right' }}>{!g.activo && <Etiqueta tono="aviso">De baja</Etiqueta>} {puedeAdministrar && <button className="btn chico" onClick={() => setFormRegimen(g)}>Editar</button>}</td></tr>)}</tbody>
            </table></div>)}
        </>
      )}
      {formRegimen && <FormRegimen regimen={formRegimen === 'nuevo' ? null : formRegimen} onCerrar={() => setFormRegimen(null)} onGuardado={() => { setFormRegimen(null); refrescar(); }} />}
      {formBanco && <FormBanco banco={formBanco === 'nueva' ? null : formBanco} onCerrar={() => setFormBanco(null)} onGuardado={() => { setFormBanco(null); refrescar(); }} />}
      {movs && <Movimientos titulo={movs.titulo} filtro={movs.filtro} onCerrar={() => setMovs(null)} />}
    </>
  );
}

function Movimientos({ titulo, filtro, onCerrar }: { titulo: string; filtro: Record<string, number>; onCerrar: () => void }) {
  const [d, setD] = useState<Pagina<MovimientoTesoreria> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { obtener<Pagina<MovimientoTesoreria>>('/api/tesoreria/movimientos', { ...filtro, limite: 50 }).then(setD).catch((e) => setError(e.message)); }, [filtro]);
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ancho={640}>
      {error && <Alerta>{error}</Alerta>}{!d && !error && <Cargando />}
      {d && d.datos.length === 0 && <Vacio titulo="Todavía no hay movimientos" />}
      {d && d.datos.length > 0 && <div className="tabla-caja"><table><thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Importe</th></tr></thead>
        <tbody>{d.datos.map((m) => <tr key={m.id}><td>{fecha(m.fecha)}</td><td>{m.concepto ?? '—'}</td><td className="num" style={{ color: Number(m.importe) < 0 ? 'var(--bad)' : 'var(--brand-ink)' }}>{Number(m.importe) > 0 ? '+' : ''}{moneda(m.importe)}</td></tr>)}</tbody></table></div>}
      {d && d.total > d.datos.length && <p className="muted">Se muestran los últimos {d.datos.length} de {d.total}.</p>}
    </Modal>
  );
}

function FormCaja({ caja, onCerrar, onGuardado }: { caja: Caja | null; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState(caja?.nombre ?? '');
  const [tipoC, setTipoC] = useState(caja?.tipo ?? 'efectivo');
  const [activa, setActiva] = useState(caja?.activa ?? true);
  const [error, setError] = useState<unknown>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    try {
      if (!caja) await enviar('POST', '/api/tesoreria/cajas', { nombre: nombre.trim(), tipo: tipoC });
      else { const c: Record<string, unknown> = {}; if (nombre.trim() !== caja.nombre) c.nombre = nombre.trim(); if (activa !== caja.activa) c.activa = activa; if (Object.keys(c).length) await enviar('PATCH', `/api/tesoreria/cajas/${caja.id}`, c); }
      avisar('Caja guardada.'); onGuardado();
    } catch (e) { setError(e); }
  }
  const general = resumenErrores(error, ['nombre', 'tipo', 'activa']);
  return (
    <Modal titulo={caja ? caja.nombre : 'Nueva caja'} onCerrar={onCerrar} ancho={460}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla"><div className="ancho"><Campo etiqueta="Nombre" value={nombre} error={campos.nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></div>
          {!caja && <Selector etiqueta="Tipo" value={tipoC} onChange={(e) => setTipoC(e.target.value as Caja['tipo'])}><option value="efectivo">Efectivo</option><option value="tarjetas">Tarjetas</option><option value="otra">Otra</option></Selector>}
          {caja && <label className="btn ancho"><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Activa {caja.activa && Number(caja.saldo) !== 0 && '(con saldo no se puede dar de baja)'}</label>}</div>
        {error instanceof ErrorApi && campos.activa && <Alerta>{campos.activa}</Alerta>}
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={nombre.trim().length < 2}>Guardar</button></div>
      </form>
    </Modal>
  );
}
function FormBanco({ banco, onCerrar, onGuardado }: { banco: Banco | null; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [v, setV] = useState({ banco: banco?.banco ?? '', cuenta: banco?.numero_cuenta ?? '', cbu: banco?.cbu ?? '', alias: banco?.alias ?? '', activa: banco?.activa ?? true });
  const [error, setError] = useState<unknown>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    const datos = { banco: v.banco.trim(), numero_cuenta: v.cuenta.trim() || null, cbu: v.cbu.trim() || null, alias: v.alias.trim() || null };
    try {
      if (!banco) await enviar('POST', '/api/tesoreria/bancos', datos);
      else { const c: Record<string, unknown> = {}; for (const [k, a] of [['banco', banco.banco], ['numero_cuenta', banco.numero_cuenta], ['cbu', banco.cbu], ['alias', banco.alias]] as const) if ((datos[k as keyof typeof datos] ?? null) !== (a ?? null)) c[k] = datos[k as keyof typeof datos]; if (v.activa !== banco.activa) c.activa = v.activa; if (Object.keys(c).length) await enviar('PATCH', `/api/tesoreria/bancos/${banco.id}`, c); }
      avisar('Cuenta guardada.'); onGuardado();
    } catch (e) { setError(e); }
  }
  const general = resumenErrores(error, ['banco', 'numero_cuenta', 'cbu', 'alias', 'activa']);
  return (
    <Modal titulo={banco ? banco.banco : 'Nueva cuenta bancaria'} onCerrar={onCerrar} ancho={520}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <Campo etiqueta="Banco" value={v.banco} error={campos.banco} onChange={(e) => setV({ ...v, banco: e.target.value })} autoFocus /><Campo etiqueta="Número de cuenta" value={v.cuenta} error={campos.numero_cuenta} onChange={(e) => setV({ ...v, cuenta: e.target.value })} />
          <div className="ancho"><Campo etiqueta="CBU" inputMode="numeric" value={v.cbu} error={campos.cbu} ayuda="22 dígitos" onChange={(e) => setV({ ...v, cbu: e.target.value })} /></div><Campo etiqueta="Alias" value={v.alias} error={campos.alias} onChange={(e) => setV({ ...v, alias: e.target.value })} />
          {banco && <label className="btn"><input type="checkbox" checked={v.activa} onChange={(e) => setV({ ...v, activa: e.target.checked })} /> Activa</label>}
        </div>
        {campos.activa && <Alerta>{campos.activa}</Alerta>}
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={v.banco.trim().length < 2}>Guardar</button></div>
      </form>
    </Modal>
  );
}

/* ====================== cheques ====================== */
const ESTADO_CHEQUE: Record<string, { texto: string; tono: 'neutro' | 'ok' | 'aviso' | 'malo' | 'info' }> = {
  en_cartera: { texto: 'En cartera', tono: 'info' }, depositado: { texto: 'Depositado', tono: 'aviso' }, acreditado: { texto: 'Acreditado', tono: 'ok' }, rechazado: { texto: 'Rechazado', tono: 'malo' },
  entregado: { texto: 'Entregado', tono: 'neutro' }, emitido: { texto: 'Emitido', tono: 'info' }, cobrado: { texto: 'Debitado', tono: 'ok' }, anulado: { texto: 'Anulado', tono: 'neutro' },
};
const ACCION_CHEQUE: Record<string, { boton: string; titulo: string; ayuda: string }> = {
  depositar: { boton: 'Depositar', titulo: 'Depositar el cheque', ayuda: 'Elegí la cuenta donde lo depositás. El banco recién recibe la plata cuando lo acreditás.' },
  acreditar: { boton: 'Acreditar', titulo: 'Acreditar el cheque', ayuda: 'Confirmá que el banco ya lo acreditó: la plata entra en la cuenta bancaria.' },
  rechazar: { boton: 'Rechazar', titulo: 'Registrar el rechazo', ayuda: 'El cheque rebotó: el cliente vuelve a deber ese importe.' },
  debitar: { boton: 'Registrar débito', titulo: 'Registrar el débito', ayuda: 'El banco debitó el cheque de la cuenta: la plata sale de la cuenta bancaria.' },
  rebotar: { boton: 'Registrar rebote', titulo: 'Registrar el rebote del cheque', ayuda: 'El proveedor al que se lo entregaste te lo devolvió porque su banco lo rechazó: volvés a deberle ese importe y el cliente que te lo dio vuelve a deberte. Después le pagás al proveedor (a cuenta) y le cobrás al cliente.' },
  aceptar: { boton: 'Aceptar ECHEQ', titulo: 'Aceptar el ECHEQ', ayuda: 'Registrá que ya lo aceptaste en el banco: recién ahí se puede depositar o entregar. El sistema no se conecta al banco, la aceptación se anota a mano.' },
};
const cobrableDesde = (c: Cheque) => c.fecha_pago ?? c.fecha_emision;

function Cheques({ puedeGestionar }: { puedeGestionar: boolean }) {
  const [estado, setEstado] = useState('');
  const [origen, setOrigen] = useState('');
  const [tipoCheque, setTipoCheque] = useState('');
  const [texto, setTexto] = useState('');
  const q = useRetraso(texto, 300);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<(Pagina<Cheque> & { resumen: ResumenCheque[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => { setPagina(0); }, [estado, origen, tipoCheque, q]);
  useEffect(() => {
    const ctl = new AbortController();
    obtener<Pagina<Cheque> & { resumen: ResumenCheque[] }>('/api/cheques', { estado, origen, echeq: tipoCheque, q: q.trim(), limite: POR_PAGINA, desplazamiento: pagina * POR_PAGINA }, ctl.signal).then((r) => { setDatos(r); setError(null); }).catch((e) => { if ((e as Error).name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [estado, origen, tipoCheque, q, pagina, recarga]);
  const total = datos?.total ?? 0, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pendientes = (datos?.resumen ?? []).filter((r) => ['en_cartera', 'depositado', 'emitido'].includes(r.estado) && r.cantidad > 0);
  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Número, código de ECHEQ, banco o persona" />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADO_CHEQUE).map(([k, v]) => <option key={k} value={k}>{k === 'cobrado' ? 'Debitado' : v.texto}</option>)}</Selector>
        <Selector etiqueta="De quién" value={origen} onChange={(e) => setOrigen(e.target.value)}><option value="">Todos</option><option value="tercero">De terceros (recibidos)</option><option value="propio">Propios (emitidos)</option></Selector>
        <Selector etiqueta="Tipo" value={tipoCheque} onChange={(e) => setTipoCheque(e.target.value)}><option value="">Todos</option><option value="true">ECHEQ</option><option value="false">De papel</option></Selector>
      </div>
      {pendientes.length > 0 && <p className="muted" style={{ margin: '0 0 10px' }}>{pendientes.map((r) => `${r.origen === 'propio' ? 'Propios' : 'De terceros'} ${ESTADO_CHEQUE[r.estado].texto.toLowerCase()}: ${r.cantidad} por ${moneda(r.importe)}`).join(' · ')}</p>}
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.datos.length === 0 && <div className="tarjeta"><Vacio titulo="No hay cheques">{estado || origen || q ? 'Probá con otros filtros.' : 'Los cheques se cargan al cobrar o pagar con el medio “Cheque”.'}</Vacio></div>}
      {datos && datos.datos.length > 0 && (
        <div className="tabla-caja"><table>
          <thead><tr><th>Cheque</th><th>Persona</th><th>Se puede cobrar</th><th className="num">Importe</th><th>Estado</th></tr></thead>
          <tbody>{datos.datos.map((c) => (
            <tr key={c.id} className="clic" onClick={() => setAbierto(c.id)}>
              <td><strong>{c.numero}</strong> {c.es_echeq && <Etiqueta tono="info">ECHEQ</Etiqueta>}<div className="muted">{c.origen === 'propio' ? `Propio · ${c.cuenta_banco ?? ''}` : c.banco}{c.echeq_codigo ? ` · ${c.echeq_codigo}` : ''}</div></td>
              <td>{c.tercero ?? '—'}</td>
              <td>{cobrableDesde(c) ? fecha(cobrableDesde(c)) : '—'} {c.diferido && <Etiqueta tono="aviso">Diferido</Etiqueta>}</td>
              <td className="num">{moneda(c.importe)}</td>
              <td><Etiqueta tono={ESTADO_CHEQUE[c.estado]?.tono ?? 'neutro'}>{ESTADO_CHEQUE[c.estado]?.texto ?? c.estado}</Etiqueta>{c.es_echeq && c.origen === 'tercero' && c.estado === 'en_cartera' && !c.aceptado_en && <> <Etiqueta tono="aviso">Sin aceptar</Etiqueta></>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {datos && total > POR_PAGINA && <div className="paginado"><span>Página {pagina + 1} de {paginas}</span><span className="acciones"><button className="btn chico" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><button className="btn chico" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button></span></div>}
      {abierto !== null && <DetalleCheque id={abierto} puedeGestionar={puedeGestionar} onCerrar={() => setAbierto(null)} onCambio={() => setRecarga((n) => n + 1)} />}
    </>
  );
}

function DetalleCheque({ id, puedeGestionar, onCerrar, onCambio }: { id: number; puedeGestionar: boolean; onCerrar: () => void; onCambio: () => void }) {
  const [c, setC] = useState<ChequeDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  useEffect(() => { obtener<ChequeDetalle>(`/api/cheques/${id}`).then(setC).catch((e) => setError(e.message)); }, [id]);
  return (
    <Modal titulo={c ? `Cheque ${c.numero}` : 'Cheque'} onCerrar={onCerrar} ancho={620}>
      {error && <Alerta>{error}</Alerta>}
      {!c && !error && <Cargando />}
      {c && (
        <>
          <p style={{ marginTop: 0 }}><strong>{moneda(c.importe)}</strong> · <Etiqueta tono={ESTADO_CHEQUE[c.estado]?.tono ?? 'neutro'}>{ESTADO_CHEQUE[c.estado]?.texto ?? c.estado}</Etiqueta> {c.diferido && <Etiqueta tono="aviso">Diferido</Etiqueta>}</p>
          <dl className="ficha">
            <dt>{c.origen === 'propio' ? 'Propio' : 'De'}</dt><dd>{c.origen === 'propio' ? `Cuenta ${c.cuenta_banco ?? ''}${c.cuenta_numero ? ` ${c.cuenta_numero}` : ''}` : c.tercero ?? '—'}</dd>
            {c.origen === 'tercero' && <><dt>Banco</dt><dd>{c.banco ?? '—'}{c.cuit_librador ? ` · librador CUIT ${c.cuit_librador}` : ''}</dd></>}
            {c.origen === 'tercero' && c.cuenta_banco && <><dt>Depositado en</dt><dd>{c.cuenta_banco}{c.cuenta_numero ? ` ${c.cuenta_numero}` : ''}</dd></>}
            {c.origen === 'propio' && c.tercero && <><dt>Entregado a</dt><dd>{c.tercero}</dd></>}
            {c.origen === 'tercero' && c.entregado_a && ['entregado', 'rechazado'].includes(c.estado) && <><dt>Endosado a</dt><dd>{c.entregado_a}</dd></>}
            {c.rebotado_proveedor && <><dt>Devuelto por</dt><dd>{c.rebotado_proveedor} (rebotó después del endoso)</dd></>}
            <dt>Emisión</dt><dd>{fecha(c.fecha_emision)}</dd><dt>Fecha de pago</dt><dd>{fecha(c.fecha_pago)}</dd>
            {c.es_echeq && <><dt>ECHEQ</dt><dd>{c.echeq_codigo} · {c.caracter === 'no_a_la_orden' ? 'no a la orden' : 'a la orden'}{c.cruzado ? ' · cruzado' : ''}</dd>{c.origen === 'tercero' && <><dt>Aceptación</dt><dd>{c.aceptado_en ? `Aceptado el ${fecha(c.aceptado_en)}` : 'Pendiente de aceptar'}</dd></>}</>}
          </dl>
          {c.es_echeq && <p className="muted" style={{ margin: '8px 0 0' }}>Datos cargados a mano: el sistema no está conectado al banco ni a la Cámara.</p>}
          <h3 style={{ margin: '16px 0 6px' }}>Historial</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{c.eventos.map((e) => <li key={e.id}>{fecha(e.fecha)} · <strong>{ESTADO_CHEQUE[e.estado_nuevo]?.texto ?? e.estado_nuevo}</strong>{e.nota ? ` — ${e.nota}` : ''}</li>)}</ul>
          {puedeGestionar && c.acciones.length > 0 && <div className="pie-form">{c.acciones.map((a) => <button key={a} className={a === 'rechazar' || a === 'rebotar' ? 'btn peligro' : 'btn primario'} onClick={() => setAccion(a)}>{ACCION_CHEQUE[a].boton}</button>)}</div>}
        </>
      )}
      {c && accion && <AccionCheque cheque={c} accion={accion} onCerrar={() => setAccion(null)} onHecho={(nuevo) => { setC(nuevo); setAccion(null); onCambio(); }} />}
    </Modal>
  );
}

function AccionCheque({ cheque, accion, onCerrar, onHecho }: { cheque: ChequeDetalle; accion: string; onCerrar: () => void; onHecho: (c: ChequeDetalle) => void }) {
  const avisar = useAviso(), def = ACCION_CHEQUE[accion];
  const [fechaA, setFechaA] = useState(hoyISO());
  const [cuenta, setCuenta] = useState('');
  const [motivo, setMotivo] = useState('');
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  useEffect(() => { if (accion === 'depositar') obtener<{ datos: Banco[] }>('/api/tesoreria/bancos').then((r) => { const a = r.datos.filter((b) => b.activa); setBancos(a); if (a.length === 1) setCuenta(String(a[0].id)); }).catch(() => setBancos([])); }, [accion]);
  async function enviarAccion(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try {
      const r = await enviar<ChequeDetalle>('POST', `/api/cheques/${cheque.id}/${accion}`, { fecha: fechaA, ...(accion === 'depositar' ? { cuenta_bancaria_id: Number(cuenta) || undefined } : {}), ...(accion === 'rechazar' || accion === 'rebotar' ? { motivo: motivo.trim() } : {}) });
      avisar(`Cheque ${cheque.numero}: ${ESTADO_CHEQUE[r.estado]?.texto.toLowerCase() ?? r.estado}.`); onHecho(r);
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['fecha', 'cuenta_bancaria_id', 'motivo']);
  return (
    <Modal titulo={def.titulo} onCerrar={onCerrar} ancho={460}>
      <form onSubmit={enviarAccion} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <p style={{ marginTop: 0 }}>Cheque <strong>{cheque.numero}</strong> por <strong>{moneda(cheque.importe)}</strong>. {def.ayuda}</p>
        <div className="rejilla">
          {accion === 'depositar' && <div className="ancho"><Selector etiqueta="Cuenta bancaria" value={cuenta} error={campos.cuenta_bancaria_id} onChange={(e) => setCuenta(e.target.value)}><option value="">Elegí…</option>{bancos.map((b) => <option key={b.id} value={b.id}>{b.banco}{b.numero_cuenta ? ` · ${b.numero_cuenta}` : ''}</option>)}</Selector></div>}
          {(accion === 'rechazar' || accion === 'rebotar') && <div className="ancho"><Campo etiqueta={accion === 'rebotar' ? 'Motivo del rebote' : 'Motivo del rechazo'} value={motivo} error={campos.motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></div>}
          <Campo etiqueta="Fecha" type="date" value={fechaA} error={campos.fecha} onChange={(e) => setFechaA(e.target.value)} />
        </div>
        {accion === 'depositar' && bancos.length === 0 && <Alerta tipo="aviso">Todavía no hay cuentas bancarias: cargá una en “Cajas y bancos”.</Alerta>}
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className={accion === 'rechazar' || accion === 'rebotar' ? 'btn peligro' : 'btn primario'} disabled={trabajando || ((accion === 'rechazar' || accion === 'rebotar') && motivo.trim().length < 3)}>{trabajando ? 'Guardando…' : def.boton}</button></div>
      </form>
    </Modal>
  );
}

function FormRegimen({ regimen, onCerrar, onGuardado }: { regimen: Regimen | null; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [v, setV] = useState({ tipo: regimen?.tipo ?? 'ganancias', jurisdiccion: regimen?.jurisdiccion_codigo ? String(regimen.jurisdiccion_codigo) : '', codigo: regimen?.codigo_arca ?? '', descripcion: regimen?.descripcion ?? '', alicuota: regimen?.alicuota ?? '', activo: regimen?.activo ?? true });
  const [jurisdicciones, setJurisdicciones] = useState<Jurisdiccion[]>([]);
  const [error, setError] = useState<unknown>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};
  useEffect(() => { obtener<{ datos: Jurisdiccion[] }>('/api/catalogos/jurisdicciones').then((r) => setJurisdicciones(r.datos)).catch(() => setJurisdicciones([])); }, []);
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    const datos = { tipo: v.tipo, jurisdiccion_codigo: v.tipo === 'iibb' && v.jurisdiccion ? Number(v.jurisdiccion) : null, codigo_arca: v.codigo.trim() || null, descripcion: v.descripcion.trim(), alicuota: aDecimal(v.alicuota) };
    try {
      if (!regimen) await enviar('POST', '/api/tesoreria/regimenes', datos);
      else { const c: Record<string, unknown> = {}; if (datos.tipo !== regimen.tipo) c.tipo = datos.tipo; if (datos.jurisdiccion_codigo !== regimen.jurisdiccion_codigo) c.jurisdiccion_codigo = datos.jurisdiccion_codigo; if (datos.codigo_arca !== (regimen.codigo_arca ?? null)) c.codigo_arca = datos.codigo_arca; if (datos.descripcion !== regimen.descripcion) c.descripcion = datos.descripcion; if (Number(datos.alicuota) !== Number(regimen.alicuota)) c.alicuota = datos.alicuota; if (v.activo !== regimen.activo) c.activo = v.activo; if (Object.keys(c).length) await enviar('PATCH', `/api/tesoreria/regimenes/${regimen.id}`, c); }
      avisar('Régimen guardado.'); onGuardado();
    } catch (e) { setError(e); }
  }
  const general = resumenErrores(error, ['tipo', 'jurisdiccion_codigo', 'codigo_arca', 'descripcion', 'alicuota', 'activo']);
  return (
    <Modal titulo={regimen ? regimen.descripcion : 'Nuevo régimen de retención'} onCerrar={onCerrar} ancho={520}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        <div className="rejilla">
          <Selector etiqueta="Impuesto" value={v.tipo} error={campos.tipo} onChange={(e) => setV({ ...v, tipo: e.target.value as Regimen['tipo'], jurisdiccion: '' })}>{Object.entries(RETENCIONES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector>
          <Selector etiqueta="Jurisdicción" value={v.jurisdiccion} disabled={v.tipo !== 'iibb'} error={campos.jurisdiccion_codigo} onChange={(e) => setV({ ...v, jurisdiccion: e.target.value })}><option value="">{v.tipo === 'iibb' ? 'Elegí…' : '—'}</option>{jurisdicciones.map((j) => <option key={j.codigo} value={j.codigo}>{j.nombre}</option>)}</Selector>
          <div className="ancho"><Campo etiqueta="Descripción" value={v.descripcion} error={campos.descripcion} onChange={(e) => setV({ ...v, descripcion: e.target.value })} autoFocus /></div>
          <Campo etiqueta="Código del régimen" value={v.codigo} error={campos.codigo_arca} ayuda="El que usa tu aplicativo (opcional)" onChange={(e) => setV({ ...v, codigo: e.target.value })} />
          <Campo etiqueta="Alícuota (%)" inputMode="decimal" value={v.alicuota} error={campos.alicuota} onChange={(e) => setV({ ...v, alicuota: e.target.value })} />
          {regimen && <label className="btn ancho"><input type="checkbox" checked={v.activo} onChange={(e) => setV({ ...v, activo: e.target.checked })} /> Activo</label>}
        </div>
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={v.descripcion.trim().length < 3 || !v.alicuota.trim()}>Guardar</button></div>
      </form>
    </Modal>
  );
}
