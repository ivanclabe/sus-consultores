import { useEffect, useMemo, useState } from 'react'
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
import { leerLibro } from '../lib/excel'
import { hayBloqueantesExtraccion, procesarLibro } from '../lib/procesarLibro'
import { supabase } from '../lib/supabase'
import type { Cuenta, Empresa, Informe } from '../lib/types'
import ClasificacionHojas from './ClasificacionHojas'
import ExploradorCuentas from './ExploradorCuentas'
import NotasArchivo from './NotasArchivo'
import ReporteExtraccion from './ReporteExtraccion'

interface Props {
  onListo: (informe: Informe, cuentas: Cuenta[]) => void
}

type Tab = 'actual' | 'anterior' | 'notas'

const LOTE = 500

async function insertarEnLotes<T>(tabla: string, filas: object[]): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < filas.length; i += LOTE) {
    const { data, error } = await supabase.from(tabla).insert(filas.slice(i, i + LOTE)).select('*')
    if (error) throw error
    out.push(...((data ?? []) as T[]))
  }
  return out
}

export default function PasoCargar({ onListo }: Props) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [empresaNueva, setEmpresaNueva] = useState('')
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

  useEffect(() => {
    supabase
      .from('sc_empresas')
      .select('id, nombre, nit')
      .order('nombre')
      .then(({ data }) => setEmpresas((data ?? []) as Empresa[]))
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

  // Paso 1 y 2: leer todas las hojas y clasificarlas. Aquí no se extrae ninguna cuenta.
  async function cargar(file: File) {
    setError(null)
    setErrorIA(null)
    setAvisosIA([])
    setArchivo(file)
    setLibro(null)
    setOpciones({})
    setTab('actual')
    try {
      const wb = leerLibro(await file.arrayBuffer())
      const ps = analizarLibro(wb)
      setLibro(wb)
      setPerfiles(ps)
      const auto = clasificarLibro(ps)
      if (auto.validaciones.some((v) => v.bloqueante && !v.ok)) pedirIA(ps)
    } catch (e) {
      setError(`No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`)
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
  const bloqueado = hayBloqueantesExtraccion(resultado)
  const pendientes = resultado?.validaciones.filter((v) => !v.ok).length ?? 0

  function cambiarDestino(hoja: string, destino: Destino) {
    setErrorIA(null)
    setOpciones((o) => ({ ...o, metodo: 'manual', destinos: { ...o.destinos, [hoja]: destino } }))
  }

  function cambiarPeriodos(anioActual: number | null, anioAnterior: number | null) {
    setOpciones((o) => ({ ...o, anioActual, anioAnterior }))
  }

  async function continuar() {
    if (!resultado || !archivo || bloqueado) return
    const { clasificacion: c, actual, anterior, cuentas, notas } = resultado
    const nombres = (d: Destino) =>
      hojasDe(c, d).filter((h) => h.seExtrae).map((h) => h.nombre).join(', ') || null
    setGuardando(true)
    setError(null)
    try {
      let idEmpresa = empresaId
      if (!idEmpresa && empresaNueva.trim()) {
        const { data, error } = await supabase
          .from('sc_empresas')
          .insert({ nombre: empresaNueva.trim() })
          .select('id, nombre, nit')
          .single()
        if (error) throw error
        idEmpresa = (data as Empresa).id
        setEmpresas((e) => [...e, data as Empresa])
      }
      if (!idEmpresa) throw new Error('Elige una empresa o escribe el nombre de una nueva.')

      const { data: { user } } = await supabase.auth.getUser()
      const { data: informe, error: e1 } = await supabase
        .from('sc_informes')
        .insert({
          empresa_id: idEmpresa,
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
          },
          reporte_extraccion: {
            validaciones: resultado.validaciones,
            descartes: resultado.descartes.slice(0, 2000),
            descartes_total: resultado.descartes.length,
          },
          creado_por: user?.id ?? null,
        })
        .select('*')
        .single()
      if (e1) throw e1
      const inf = informe as Informe

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
          metodo_clasificacion: c.metodo,
          hojas: { actual: nombres('actual'), anterior: nombres('anterior'), notas: nombres('notas') },
          anios: { actual: c.anioActual, anterior: c.anioAnterior },
          cuentas: cuentas.filter((c) => c.nivel !== 'tercero').length,
          terceros: cuentas.filter((c) => c.nivel === 'tercero').length,
          notas: notas?.notas.length ?? 0,
          filas_no_incorporadas: resultado.descartes.length,
        },
      })

      onListo(inf, filas)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }


  return (
    <>
      <div className="panel">
        <h2>1. Cargar el archivo de estados financieros</h2>
        <p className="sutil-texto">
          Al cargar el libro, primero se clasifican todas sus hojas en año actual, año anterior y
          notas; los años se leen del propio archivo. Después se extraen las cuentas y las notas de
          cada grupo. El archivo no se almacena: solo lo que se extrae de él.
        </p>
        {error && <div className="aviso error">{error}</div>}
        <div className="fila">
          <div className="campo">
            <label htmlFor="archivo">Archivo Excel</label>
            <input
              id="archivo"
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange={(e) => e.target.files?.[0] && cargar(e.target.files[0])}
            />
          </div>
          <div className="campo">
            <label htmlFor="empresa">Empresa</label>
            <select id="empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">— nueva —</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          {!empresaId && (
            <div className="campo">
              <label htmlFor="nueva">Nombre de la empresa</label>
              <input
                id="nueva"
                value={empresaNueva}
                onChange={(e) => setEmpresaNueva(e.target.value)}
                placeholder="Ej. BL Ventures S.A.S."
              />
            </div>
          )}
        </div>
      </div>

      {clasificacion && (
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
      )}

      {clasificacion && resultado && (
        <div className="panel">
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
              <span className="sutil-texto">Ninguna hoja clasificada aquí.</span>
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
          {tab === 'notas' &&
            (resultado.notas && clasificacion.anioActual !== null && clasificacion.anioAnterior !== null ? (
              <NotasArchivo
                notas={resultado.notas}
                anioActual={clasificacion.anioActual}
                anioAnterior={clasificacion.anioAnterior}
              />
            ) : (
              <p className="sutil-texto">
                {hojasDe(clasificacion, 'notas').length === 0
                  ? 'No hay hojas de notas asignadas.'
                  : 'Las notas se leen cuando estén identificados los dos períodos.'}
              </p>
            ))}

          <details className="validaciones-carga" open={bloqueado}>
            <summary>
              <b>Validaciones</b>
              <span className="sutil-texto">
                {pendientes ? ` — ${pendientes} por revisar` : ' — todo en orden'}
              </span>
            </summary>
            <ReporteExtraccion validaciones={resultado.validaciones} descartes={resultado.descartes} />
          </details>

          <div className="fila" style={{ marginTop: 16 }}>
            <button className="primario" onClick={continuar} disabled={bloqueado || guardando || consultandoIA}>
              {guardando ? 'Guardando…' : 'Continuar a la clasificación de cuentas'}
            </button>
            {bloqueado && (
              <span className="sutil-texto">Hay validaciones que bloquean: revísalas arriba o en «Validaciones».</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}
