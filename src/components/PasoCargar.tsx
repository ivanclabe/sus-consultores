import { useEffect, useMemo, useRef, useState } from 'react'
import type * as XLSX from 'xlsx'
import {
  NOMBRE_TIPO,
  analizarLibro,
  clasificarLibro,
  hojasDe,
  type Destino,
  type OpcionesClasificacion,
  type PerfilHoja,
} from '../lib/clasificarHojas'
import { clasificarConIA } from '../lib/clasificarConIA'
import {
  digitosNit,
  encabezadoInicial,
  extraerDatosCorporativos,
  llaveEmpresa,
  normalizarNit,
  type Encabezado,
} from '../lib/empresaArchivo'
import { leerLibro } from '../lib/excel'
import { hayBloqueantesExtraccion, procesarLibro } from '../lib/procesarLibro'
import { supabase } from '../lib/supabase'
import type { Cuenta, Empresa, Informe } from '../lib/types'
import ClasificacionHojas from './ClasificacionHojas'
import ExploradorCuentas from './ExploradorCuentas'
import NotasArchivo from './NotasArchivo'
import ReporteExtraccion from './ReporteExtraccion'

interface Props {
  informe: Informe | null
  onListo: (informe: Informe, cuentas: Cuenta[], encabezado: Encabezado) => void
}

type Tab = 'actual' | 'anterior' | 'notas'

const LOTE = 500
const COLUMNAS_EMPRESA =
  'id, nombre, nit, ciudad, representante_legal, contador, tarjeta_contador, revisor_fiscal, tarjeta_revisor'

async function insertarEnLotes<T>(tabla: string, filas: object[]): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < filas.length; i += LOTE) {
    const { data, error } = await supabase.from(tabla).insert(filas.slice(i, i + LOTE)).select('*')
    if (error) throw error
    out.push(...((data ?? []) as T[]))
  }
  return out
}

const tamano = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

export default function PasoCargar({ informe, onListo }: Props) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [seleccion, setSeleccion] = useState<string>('auto') // 'auto' | 'nueva' | id
  const [razonEditada, setRazonEditada] = useState<string | null>(null)
  const [nitEditado, setNitEditado] = useState<string | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [libro, setLibro] = useState<XLSX.WorkBook | null>(null)
  const [perfiles, setPerfiles] = useState<PerfilHoja[]>([])
  const [opciones, setOpciones] = useState<OpcionesClasificacion>({})
  const [avisosIA, setAvisosIA] = useState<string[]>([])
  const [consultandoIA, setConsultandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('actual')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase
      .from('sc_empresas')
      .select(COLUMNAS_EMPRESA)
      .order('nombre')
      .then(({ data, error }) => {
        // Sin la migración de encabezado, se trabaja con las columnas básicas.
        if (error) {
          supabase.from('sc_empresas').select('id, nombre, nit').order('nombre')
            .then(({ data: d }) => setEmpresas((d ?? []) as Empresa[]))
        } else setEmpresas((data ?? []) as Empresa[])
      })
  }, [])

  async function pedirIA(ps: PerfilHoja[]) {
    setConsultandoIA(true)
    setErrorIA(null)
    try {
      const ia = await clasificarConIA(ps)
      setPerfiles(ia.perfiles)
      setOpciones((o) => ({
        destinos: o.destinos,
        metodo: 'ia',
        razon: ia.razon,
        ...(ia.anioActual !== null ? { anioActual: ia.anioActual } : {}),
        ...(ia.anioAnterior !== null ? { anioAnterior: ia.anioAnterior } : {}),
      }))
      setAvisosIA(ia.discrepancias)
    } catch (e) {
      setErrorIA(`${e instanceof Error ? e.message : String(e)}. Asigna las hojas a mano.`)
    } finally {
      setConsultandoIA(false)
    }
  }

  // Leer todas las hojas y clasificarlas. Aquí no se extrae ninguna cuenta.
  async function cargar(file: File) {
    setError(null)
    setErrorIA(null)
    setAvisosIA([])
    setArchivo(file)
    setLibro(null)
    setOpciones({})
    setTab('actual')
    setRazonEditada(null)
    setNitEditado(null)
    setSeleccion('auto')
    setLeyendo(true)
    try {
      const wb = leerLibro(await file.arrayBuffer())
      const ps = analizarLibro(wb)
      setLibro(wb)
      setPerfiles(ps)
      const auto = clasificarLibro(ps)
      if (auto.validaciones.some((v) => v.bloqueante && !v.ok)) pedirIA(ps)
    } catch (e) {
      setError(`No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLeyendo(false)
    }
  }

  const clasificacion = useMemo(
    () => (libro ? clasificarLibro(perfiles, opciones) : null),
    [libro, perfiles, opciones],
  )
  // Solo después de clasificar: extracción, período por período.
  const resultado = useMemo(
    () => (libro && clasificacion ? procesarLibro(libro, clasificacion) : null),
    [libro, clasificacion],
  )
  const datos = useMemo(() => {
    if (!libro || !clasificacion) return null
    const nombres = (d: Destino) => hojasDe(clasificacion, d).map((h) => h.nombre)
    return extraerDatosCorporativos(libro, {
      actual: nombres('actual').filter((n) => hojasDe(clasificacion, 'actual').find((h) => h.nombre === n)?.seExtrae),
      anterior: nombres('anterior'),
      resto: [...clasificacion.hojas.filter((h) => h.tipo === 'estado').map((h) => h.nombre), ...nombres('notas')],
    })
  }, [libro, clasificacion])

  const razon = (razonEditada ?? datos?.razonSocial?.valor ?? '').trim()
  const nit = (nitEditado ?? datos?.nit?.valor ?? '').trim()

  const coincidente = useMemo(() => {
    const d = digitosNit(nit)
    return (
      (d && empresas.find((e) => digitosNit(e.nit) === d)) ||
      (razon && empresas.find((e) => llaveEmpresa(e.nombre) === llaveEmpresa(razon))) ||
      null
    )
  }, [empresas, nit, razon])
  const empresaDestino: Empresa | 'nueva' =
    seleccion === 'auto' ? (coincidente ?? 'nueva') : seleccion === 'nueva' ? 'nueva' : (empresas.find((e) => e.id === seleccion) ?? 'nueva')

  const bloqueado = hayBloqueantesExtraccion(resultado)
  const fallas = resultado?.validaciones.filter((v) => v.bloqueante && !v.ok) ?? []
  const pendientes = resultado?.validaciones.filter((v) => !v.ok).length ?? 0
  const faltaEmpresa = empresaDestino === 'nueva' && !razon
  const nCuentas = resultado?.cuentas.filter((c) => c.nivel !== 'tercero' && c.esHoja).length ?? 0
  const nNotas = resultado?.notas?.notas.length ?? 0

  function cambiarDestino(hoja: string, destino: Destino) {
    setErrorIA(null)
    setOpciones((o) => ({ ...o, metodo: 'manual', destinos: { ...o.destinos, [hoja]: destino } }))
  }

  function cambiarPeriodos(anioActual: number | null, anioAnterior: number | null) {
    setOpciones((o) => ({ ...o, anioActual, anioAnterior }))
  }

  async function asegurarEmpresa(): Promise<Empresa> {
    const nitFormal = normalizarNit(`NIT ${nit}`) ?? (nit || null)
    if (empresaDestino === 'nueva') {
      if (!razon) throw new Error('Escribe la razón social de la empresa.')
      const { data, error } = await supabase
        .from('sc_empresas')
        .insert({ nombre: razon, nit: nitFormal })
        .select('id, nombre, nit')
        .single()
      if (error) throw error
      setEmpresas((e) => [...e, data as Empresa])
      return data as Empresa
    }
    // La empresa ya existe: se completa el NIT si no lo tenía.
    if (!empresaDestino.nit && nitFormal) {
      await supabase.from('sc_empresas').update({ nit: nitFormal }).eq('id', empresaDestino.id)
    }
    return empresaDestino
  }

  async function continuar() {
    if (!resultado || !archivo || bloqueado || !datos) return
    const { clasificacion: c, actual, anterior, cuentas, notas } = resultado
    const nombres = (d: Destino) =>
      hojasDe(c, d).filter((h) => h.seExtrae).map((h) => h.nombre).join(', ') || null
    setGuardando(true)
    setError(null)
    try {
      const empresa = await asegurarEmpresa()
      const enc = encabezadoInicial(datos, c.anioActual, c.anioAnterior, {
        ciudad: empresa.ciudad ?? '',
        representanteLegal: empresa.representante_legal ?? '',
        contador: empresa.contador ?? '',
        tarjetaContador: empresa.tarjeta_contador ?? '',
        revisorFiscal: empresa.revisor_fiscal ?? '',
        tarjetaRevisor: empresa.tarjeta_revisor ?? '',
      })
      enc.razonSocial = razon || empresa.nombre
      enc.nit = nit || empresa.nit || ''

      const { data: { user } } = await supabase.auth.getUser()
      const fila = {
        empresa_id: empresa.id,
        nombre_archivo: archivo.name,
        hoja_origen: nombres('actual'),
        hoja_anterior: nombres('anterior'),
        hoja_notas: nombres('notas'),
        periodo_actual: c.anioActual,
        periodo_anterior: c.anioAnterior,
        mapeo_columnas: {
          actual: actual?.hojas.map((h) => h.mapeo),
          anterior: anterior?.hojas.map((h) => h.mapeo),
        },
        identificacion: {
          metodo: c.metodo,
          razon: c.razon,
          anio_actual: c.anioActual,
          anio_anterior: c.anioAnterior,
          hojas: c.hojas.map((h) => ({
            nombre: h.nombre,
            tipo: h.tipo,
            periodos: h.anios,
            destino: h.destino,
            se_extrae: h.seExtrae,
            manual: h.manual,
            motivo: h.motivo,
          })),
          datos_corporativos: datos,
        },
        reporte_extraccion: {
          validaciones: resultado.validaciones,
          descartes: resultado.descartes.slice(0, 2000),
          descartes_total: resultado.descartes.length,
        },
        encabezado: enc,
        creado_por: user?.id ?? null,
      }
      let ins = await supabase.from('sc_informes').insert(fila).select('*').single()
      if (ins.error && /encabezado/.test(ins.error.message)) {
        // Base sin la migración del encabezado: se guarda igual y el encabezado vive en memoria.
        const { encabezado: _omitido, ...sinEncabezado } = fila
        ins = await supabase.from('sc_informes').insert(sinEncabezado).select('*').single()
      }
      if (ins.error) throw ins.error
      const inf = ins.data as Informe

      const filas = await insertarEnLotes<Cuenta>(
        'sc_cuentas',
        cuentas.map((c) => ({
          informe_id: inf.id,
          clave: c.clave,
          codigo: c.codigo,
          nombre: c.nombre,
          nivel: c.nivel,
          es_hoja: c.esHoja,
          codigo_padre: c.padre,
          nit: c.nit,
          fila_origen: c.filaActual,
          fila_anterior: c.filaAnterior,
          celda_actual: c.celdaActual,
          celda_anterior: c.celdaAnterior,
          saldo_actual: c.actual,
          saldo_anterior: c.anterior,
          saldo_inicial: c.saldoInicial,
        })),
      )

      if (notas && notas.notas.length) {
        const conId = notas.notas.map((n) => ({ ...n, id: crypto.randomUUID() }))
        await insertarEnLotes('sc_notas_archivo', conId.map((n) => ({
          id: n.id,
          informe_id: inf.id,
          hoja: n.hoja,
          orden: n.orden,
          numero: n.numero,
          titulo: n.titulo,
          seccion: n.seccion,
          fila_inicio: n.filaInicio,
          fila_fin: n.filaFin,
        })))
        await insertarEnLotes('sc_notas_archivo_lineas', conId.flatMap((n) =>
          n.lineas.map((l) => ({
            nota_id: n.id,
            informe_id: inf.id,
            orden: l.orden,
            fila_origen: l.fila,
            etiqueta: l.etiqueta,
            sangria: l.sangria,
            tipo: l.tipo,
            valor_actual: l.actual,
            valor_anterior: l.anterior,
            celda_actual: l.celdaActual,
            celda_anterior: l.celdaAnterior,
          })),
        ))
      }

      await supabase.from('sc_auditoria').insert({
        informe_id: inf.id,
        usuario_id: user?.id ?? null,
        accion: 'cargar_archivo',
        detalle: {
          archivo: archivo.name,
          empresa: { id: empresa.id, razon_social: enc.razonSocial, nit: enc.nit },
          metodo_clasificacion: c.metodo,
          hojas: { actual: nombres('actual'), anterior: nombres('anterior'), notas: nombres('notas') },
          anios: { actual: c.anioActual, anterior: c.anioAnterior },
          cuentas: cuentas.filter((c) => c.nivel !== 'tercero').length,
          terceros: cuentas.filter((c) => c.nivel === 'tercero').length,
          notas: notas?.notas.length ?? 0,
          filas_no_incorporadas: resultado.descartes.length,
        },
      })

      onListo(inf, filas, enc)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  const soltar = (e: React.DragEvent) => {
    e.preventDefault()
    setArrastrando(false)
    const f = e.dataTransfer.files?.[0]
    if (f) cargar(f)
  }

  const zona = (
    <div
      className={`zona-carga ${archivo ? 'compacta' : ''} ${arrastrando ? 'encima' : ''}`}
      onClick={() => entrada.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setArrastrando(true)
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={soltar}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && entrada.current?.click()}
    >
      <input
        ref={entrada}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) cargar(f)
          e.target.value = ''
        }}
      />
      <div className="icono">↑</div>
      {archivo ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{archivo.name}</b>
          <div className="sutil-texto">
            {tamano(archivo.size)} · {libro ? `${libro.SheetNames.length} hojas` : leyendo ? 'leyendo…' : ''}
          </div>
        </div>
      ) : (
        <>
          <b>Arrastra aquí el libro de Excel o haz clic para elegirlo</b>
          <span className="sutil-texto">
            .xlsx, .xls o .xlsm con el balance de comprobación del año actual y del anterior (exportados de
            Siigo). La hoja de notas es opcional.
          </span>
        </>
      )}
      {archivo && <button className="sutil">Cambiar archivo</button>}
    </div>
  )

  if (!archivo) {
    return (
      <div className="panel">
        <div className="panel-titulo">
          <div>
            <h2>Cargar el archivo de estados financieros</h2>
            <p className="sutil-texto">
              Se leen todas las hojas, se identifican los períodos y la empresa, y se extraen las cuentas. El
              archivo no se almacena: solo lo que se extrae de él.
            </p>
          </div>
        </div>
        {informe && (
          <div className="aviso info">
            Hay un informe en curso ({informe.nombre_archivo}). Cargar otro archivo crea un informe nuevo.
          </div>
        )}
        {error && <div className="aviso error">{error}</div>}
        {zona}
      </div>
    )
  }

  const periodoTarjeta = (d: 'actual' | 'anterior') => {
    const anio = d === 'actual' ? clasificacion?.anioActual : clasificacion?.anioAnterior
    const hojas = clasificacion ? hojasDe(clasificacion, d).filter((h) => h.seExtrae) : []
    const ext = resultado?.[d]
    const ok = anio != null && hojas.length > 0
    return (
      <div className={`tarjeta ${ok ? 'ok' : 'error'}`}>
        <span className="rotulo">{d === 'actual' ? 'Año actual' : 'Año anterior'}</span>
        <span className="valor grande">{anio ?? '—'}</span>
        <span className="sutil-texto">
          {ok
            ? `${hojas.map((h) => `«${h.nombre}»`).join(' + ')} · ${ext?.union.filas.filter((f) => f.nivel !== 'tercero').length ?? 0} cuentas`
            : 'Sin balance de comprobación identificado'}
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="panel">
        <div className="panel-titulo">
          <div>
            <h2>Archivo cargado</h2>
            <p className="sutil-texto">Revisa lo que se identificó. Solo hace falta intervenir si algo está en rojo.</p>
          </div>
        </div>
        {error && <div className="aviso error">{error}</div>}
        {zona}

        {clasificacion && resultado && (
          <div className="rejilla rejilla-4" style={{ marginTop: 14 }}>
            <div className={`tarjeta ${razon ? 'ok' : 'alerta'}`}>
              <span className="rotulo">Empresa</span>
              <span className="valor">{razon || 'No identificada'}</span>
              <span className="sutil-texto">
                {nit ? `NIT ${nit}` : 'NIT no encontrado'}
                {datos?.razonSocial && ` · leído de «${datos.razonSocial.hoja}» ${datos.razonSocial.celda}`}
              </span>
            </div>
            {periodoTarjeta('actual')}
            {periodoTarjeta('anterior')}
            <div className={`tarjeta ${nNotas ? 'ok' : ''}`}>
              <span className="rotulo">Notas del archivo · opcional</span>
              <span className="valor grande">{nNotas || '—'}</span>
              <span className="sutil-texto">
                {nNotas
                  ? `${nNotas} notas leídas como referencia`
                  : 'Sin hoja de notas: el informe arma sus notas desde el balance'}
              </span>
            </div>
          </div>
        )}
      </div>

      {clasificacion && resultado && datos && (
        <div className="panel">
          <div className="panel-titulo">
            <div>
              <h2>Datos de la empresa</h2>
              <p className="sutil-texto">
                Se leyeron del encabezado del archivo e irán en la portada y en cada estado. Corrígelos si hace falta.
              </p>
            </div>
          </div>
          {datos.otrasEmpresas.length > 0 && (
            <div className="aviso alerta">
              El libro también menciona{' '}
              {datos.otrasEmpresas.map((o) => `${o.valor} en «${o.hoja}»`).join('; ')}. Verifica que esas hojas
              sean de esta empresa; el informe usa los datos de los balances.
            </div>
          )}
          <div className="campos">
            <div className="campo">
              <label htmlFor="razon">Razón social</label>
              <input
                id="razon"
                value={razonEditada ?? datos.razonSocial?.valor ?? ''}
                onChange={(e) => setRazonEditada(e.target.value)}
                placeholder="Ej. EMPRESA EJEMPLO S.A.S."
              />
            </div>
            <div className="campo">
              <label htmlFor="nit">NIT</label>
              <input
                id="nit"
                value={nitEditado ?? datos.nit?.valor ?? ''}
                onChange={(e) => setNitEditado(e.target.value)}
                placeholder="900.000.000-0"
              />
            </div>
            <div className="campo">
              <label htmlFor="empresa">Empresa en el sistema</label>
              <select id="empresa" value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
                <option value="auto">
                  {coincidente ? `${coincidente.nombre} (reconocida)` : `Crear nueva: ${razon || 'sin nombre'}`}
                </option>
                {coincidente && <option value="nueva">Crear nueva: {razon || 'sin nombre'}</option>}
                {empresas
                  .filter((e) => e.id !== coincidente?.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                      {e.nit ? ` · ${e.nit}` : ''}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <p className="sutil-texto" style={{ marginTop: 8, marginBottom: 0 }}>
            {empresaDestino === 'nueva'
              ? 'Se registrará como empresa nueva. Las cuentas que confirmes quedarán en su memoria para los próximos informes.'
              : `Se usará «${empresaDestino.nombre}» y su memoria de clasificación${empresaDestino.contador ? '; los firmantes guardados se cargan en el encabezado' : ''}.`}
          </p>
        </div>
      )}

      {clasificacion && (
        <details className="seccion" open={clasificacion.validaciones.some((v) => v.bloqueante && !v.ok)}>
          <summary>
            Hojas del libro
            <span className="resumen">
              {clasificacion.hojas.length} hojas ·{' '}
              {clasificacion.validaciones.some((v) => v.bloqueante && !v.ok) ? 'requiere revisión' : 'clasificación completa'}
            </span>
          </summary>
          <div className="cuerpo">
            <ClasificacionHojas
              clasificacion={clasificacion}
              onDestino={cambiarDestino}
              onPeriodos={cambiarPeriodos}
              onRestablecer={() => setOpciones((o) => ({ ...o, destinos: {}, metodo: undefined }))}
              consultandoIA={consultandoIA}
              errorIA={errorIA}
              avisosIA={avisosIA}
              onPedirIA={() => pedirIA(perfiles)}
            />
          </div>
        </details>
      )}

      {clasificacion && resultado && (
        <details className="seccion">
          <summary>
            Explorar los datos extraídos
            <span className="resumen">{nCuentas} cuentas de detalle · {nNotas} notas</span>
          </summary>
          <div className="cuerpo">
            <div className="tabs tabs-periodo">
              {([
                ['actual', clasificacion.anioActual, 'Año actual'],
                ['anterior', clasificacion.anioAnterior, 'Año anterior'],
                ['notas', null, 'Notas'],
              ] as [Tab, number | null, string][]).map(([t, anio, nombre]) => (
                <button key={t} className={tab === t ? 'activo' : ''} onClick={() => setTab(t)}>
                  {anio !== null && <b>{anio}</b>}
                  {nombre}
                  <span className="sutil-texto"> ({hojasDe(clasificacion, t).length})</span>
                </button>
              ))}
            </div>

            <div className="hojas-tab">
              {hojasDe(clasificacion, tab).length === 0 ? (
                <span className="sutil-texto">
                  {tab === 'notas' ? 'El libro no trae hoja de notas (es opcional).' : 'Ninguna hoja clasificada aquí.'}
                </span>
              ) : (
                hojasDe(clasificacion, tab).map((h) => (
                  <span key={h.nombre} className={`chip-hoja ${h.seExtrae ? 'extrae' : ''}`}>
                    <b>{h.nombre}</b> · {NOMBRE_TIPO[h.tipo]}
                    {h.anios.length > 0 && ` · ${h.anios.join(', ')}`}
                    <span className="sutil-texto"> · {h.seExtrae ? 'se extrae' : 'solo referencia'}</span>
                  </span>
                ))
              )}
            </div>

            {(tab === 'actual' || tab === 'anterior') &&
              (resultado[tab] ? (
                <ExploradorCuentas key={tab} periodo={resultado[tab]!} />
              ) : (
                <p className="sutil-texto">
                  {(tab === 'actual' ? clasificacion.anioActual : clasificacion.anioAnterior) === null
                    ? 'Este período todavía no está identificado. Revisa la clasificación de las hojas.'
                    : 'Este período no tiene un balance de comprobación asignado: no hay cuentas que mostrar.'}
                </p>
              ))}
            {tab === 'notas' && resultado.notas && clasificacion.anioActual !== null && clasificacion.anioAnterior !== null && (
              <NotasArchivo
                notas={resultado.notas}
                anioActual={clasificacion.anioActual}
                anioAnterior={clasificacion.anioAnterior}
              />
            )}
          </div>
        </details>
      )}

      {resultado && (
        <details className="seccion" open={bloqueado}>
          <summary>
            Validaciones de la extracción
            <span className="resumen">
              {fallas.length ? `${fallas.length} bloquean` : pendientes ? `${pendientes} por revisar` : 'todo en orden'}
            </span>
          </summary>
          <div className="cuerpo">
            <ReporteExtraccion validaciones={resultado.validaciones} descartes={resultado.descartes} />
          </div>
        </details>
      )}

      {resultado && (
        <div className="barra-accion">
          <div className="contenido">
            <div className="estado">
              <span className={`punto ${bloqueado || faltaEmpresa ? 'error' : pendientes ? 'alerta' : 'ok'}`} />
              <span>
                {consultandoIA
                  ? 'La IA está revisando las hojas…'
                  : bloqueado
                    ? `${fallas.length} validación(es) impiden continuar: ${fallas[0]?.titulo}.`
                    : faltaEmpresa
                      ? 'Escribe la razón social de la empresa.'
                      : `Listo: ${nCuentas} cuentas de ${clasificacion?.anioActual} y ${clasificacion?.anioAnterior}` +
                        (pendientes ? ` · ${pendientes} aviso(s) para revisar` : '') + '.'}
              </span>
            </div>
            <button
              className="primario grande"
              onClick={continuar}
              disabled={bloqueado || guardando || consultandoIA || faltaEmpresa}
            >
              {guardando ? 'Guardando…' : 'Continuar: clasificar cuentas →'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
