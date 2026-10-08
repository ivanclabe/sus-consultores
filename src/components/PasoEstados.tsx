import { useMemo, useState } from 'react'
import { construirEstados } from '../lib/calculos'
import {
  armarDocumento,
  firmantes,
  formatoNumero,
  formatoPorcentaje,
  textoCorte,
  textoPeriodoResultados,
  type DocumentoFinanciero,
  type FilaPresentacion,
} from '../lib/documento'
import type { Encabezado } from '../lib/empresaArchivo'
import { supabase } from '../lib/supabase'
import { ejecutarValidaciones, hayBloqueantes } from '../lib/validaciones'
import type { CuentaClasificada, Informe, Rubro } from '../lib/types'

interface Props {
  informe: Informe
  clasificadas: CuentaClasificada[]
  rubros: Rubro[]
  encabezado: Encabezado
  onEncabezado: (e: Encabezado) => void
  onAprobado: (informe: Informe) => void
  onVolver: () => void
}

type Vista = 'esf' | 'er' | 'notas'

function Cabecera({ d, titulo, subtitulo }: { d: DocumentoFinanciero; titulo: string; subtitulo: string }) {
  return (
    <div className="doc-cabecera">
      <div className={`empresa ${d.encabezado.razonSocial ? '' : 'vacio'}`}>
        {d.encabezado.razonSocial || 'Falta la razón social'}
      </div>
      <div className="nit">{d.encabezado.nit ? `NIT ${d.encabezado.nit}` : 'NIT sin registrar'}</div>
      <div className="titulo">{titulo}</div>
      <div className="corte">{subtitulo}</div>
      <div className="moneda">{d.encabezado.moneda}</div>
    </div>
  )
}

function TablaDoc({ d, filas }: { d: DocumentoFinanciero; filas: FilaPresentacion[] }) {
  return (
    <table className="doc">
      <thead>
        <tr>
          <th>Concepto</th>
          <th className="num" style={{ textAlign: 'center' }}>Nota</th>
          <th className="num">{d.periodoActual}</th>
          {d.periodoAnterior && <th className="num">{d.periodoAnterior}</th>}
          {d.periodoAnterior && <th className="num">Variación</th>}
          {d.periodoAnterior && <th className="num">%</th>}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) =>
          f.tipo === 'seccion' || f.tipo === 'titulo' || f.tipo === 'espacio' ? (
            <tr key={i} className={`f-${f.tipo}`}>
              <td colSpan={d.periodoAnterior ? 6 : 3}>{f.etiqueta}</td>
            </tr>
          ) : (
            <tr key={i} className={`f-${f.tipo}`}>
              <td>{f.tipo === 'gran_total' ? f.etiqueta.toUpperCase() : f.etiqueta}</td>
              <td className="nota-ref">{f.nota ?? ''}</td>
              <td className="num">{formatoNumero(f.actual)}</td>
              {d.periodoAnterior && <td className="num">{formatoNumero(f.anterior)}</td>}
              {d.periodoAnterior && <td className="num var">{formatoNumero(f.variacion)}</td>}
              {d.periodoAnterior && <td className="num pct">{formatoPorcentaje(f.porcentaje)}</td>}
            </tr>
          ),
        )}
      </tbody>
    </table>
  )
}

function Firmas({ d }: { d: DocumentoFinanciero }) {
  return (
    <>
      <p className="pie-doc">Las notas adjuntas son parte integral de estos estados financieros.</p>
      <div className="firmas">
        {firmantes(d.encabezado).map((f) => (
          <div key={f.cargo}>
            <b>{f.nombre || ' '}</b>
            <span>{f.cargo}</span>
            {f.detalle && <span> · {f.detalle}</span>}
          </div>
        ))}
      </div>
    </>
  )
}

function NotasDoc({ d }: { d: DocumentoFinanciero }) {
  if (d.notas.length === 0) return <p className="sutil-texto">No hay notas con saldo para presentar.</p>
  return (
    <>
      {d.notas.map((n) => (
        <div className="doc-nota" key={n.numero}>
          <h4>
            <span>Nota {n.numero}.</span>
            {n.titulo}
          </h4>
          <table className="doc">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Código</th>
                <th>Cuenta</th>
                <th className="num">{d.periodoActual}</th>
                {d.periodoAnterior && <th className="num">{d.periodoAnterior}</th>}
                {d.periodoAnterior && <th className="num">Variación</th>}
              </tr>
            </thead>
            <tbody>
              {n.lineas.map((l, i) => (
                <tr key={i}>
                  <td className="tenue">{l.codigo}</td>
                  <td>{l.nombre}</td>
                  <td className="num">{formatoNumero(l.actual)}</td>
                  {d.periodoAnterior && <td className="num">{formatoNumero(l.anterior)}</td>}
                  {d.periodoAnterior && <td className="num var">{formatoNumero(l.variacion)}</td>}
                </tr>
              ))}
              <tr className="total-nota">
                <td></td>
                <td>Total nota {n.numero}</td>
                <td className="num">{formatoNumero(n.totalActual)}</td>
                {d.periodoAnterior && <td className="num">{formatoNumero(n.totalAnterior)}</td>}
                {d.periodoAnterior && <td className="num">{formatoNumero(n.variacion)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}

const CAMPOS: [keyof Encabezado, string, boolean?][] = [
  ['razonSocial', 'Razón social', true],
  ['nit', 'NIT'],
  ['ciudad', 'Ciudad'],
  ['fechaCorte', 'Fecha de corte'],
  ['fechaCorteAnterior', 'Corte comparativo'],
  ['moneda', 'Moneda / unidad', true],
  ['representanteLegal', 'Representante legal', true],
  ['contador', 'Contador público'],
  ['tarjetaContador', 'T.P. contador'],
  ['revisorFiscal', 'Revisor fiscal (si aplica)'],
  ['tarjetaRevisor', 'T.P. revisor'],
]

export default function PasoEstados({
  informe,
  clasificadas,
  rubros,
  encabezado,
  onEncabezado,
  onAprobado,
  onVolver,
}: Props) {
  const [vista, setVista] = useState<Vista>('esf')
  const [error, setError] = useState<string | null>(null)
  const [aprobando, setAprobando] = useState(false)
  const [generando, setGenerando] = useState<'pdf' | 'xlsx' | null>(null)
  const [verValidaciones, setVerValidaciones] = useState(false)

  const { notas, esf, er, validaciones, convencion } = useMemo(() => {
    const e = construirEstados(clasificadas, rubros)
    return { ...e, validaciones: ejecutarValidaciones(clasificadas, rubros, e.notas, e.esf, e.er) }
  }, [clasificadas, rubros])

  const doc = useMemo(
    () =>
      armarDocumento({
        encabezado,
        periodoActual: informe.periodo_actual,
        periodoAnterior: informe.periodo_anterior,
        esf,
        er,
        notas,
        aprobadoAt: informe.aprobado_at,
      }),
    [encabezado, informe, esf, er, notas],
  )

  const bloqueado = hayBloqueantes(validaciones)
  const aprobado = informe.estado === 'aprobado'
  const fallidas = validaciones.filter((v) => !v.ok)
  const faltan = [
    !encabezado.razonSocial && 'razón social',
    !encabezado.nit && 'NIT',
    !encabezado.representanteLegal && 'representante legal',
    !encabezado.contador && 'contador',
  ].filter(Boolean) as string[]

  /** El encabezado queda con el informe; los firmantes se recuerdan para la empresa. */
  async function guardarEncabezado() {
    await supabase.from('sc_informes').update({ encabezado }).eq('id', informe.id)
    if (informe.empresa_id) {
      await supabase
        .from('sc_empresas')
        .update({
          nit: encabezado.nit || null,
          ciudad: encabezado.ciudad || null,
          representante_legal: encabezado.representanteLegal || null,
          contador: encabezado.contador || null,
          tarjeta_contador: encabezado.tarjetaContador || null,
          revisor_fiscal: encabezado.revisorFiscal || null,
          tarjeta_revisor: encabezado.tarjetaRevisor || null,
        })
        .eq('id', informe.empresa_id)
    }
  }

  async function aprobar() {
    setAprobando(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('sc_validaciones').delete().eq('informe_id', informe.id)
      const { error: ev } = await supabase.from('sc_validaciones').insert(
        validaciones.map((v) => ({
          informe_id: informe.id,
          codigo: v.codigo,
          titulo: v.titulo,
          ok: v.ok,
          bloqueante: v.bloqueante,
          detalle: { texto: v.detalle },
        })),
      )
      if (ev) throw ev
      await guardarEncabezado()
      const { data, error } = await supabase
        .from('sc_informes')
        .update({
          estado: 'aprobado',
          aprobado_por: user?.id ?? null,
          aprobado_at: new Date().toISOString(),
        })
        .eq('id', informe.id)
        .select('*')
        .single()
      if (error) throw error
      await supabase.from('sc_auditoria').insert({
        informe_id: informe.id,
        usuario_id: user?.id ?? null,
        accion: 'aprobar',
        detalle: {
          notas: notas.length,
          validaciones_ok: validaciones.filter((v) => v.ok).length,
          encabezado: { razon_social: encabezado.razonSocial, nit: encabezado.nit },
        },
      })
      onAprobado(data as Informe)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAprobando(false)
    }
  }

  async function exportar(tipo: 'pdf' | 'xlsx') {
    setGenerando(tipo)
    setError(null)
    try {
      if (tipo === 'pdf') {
        const { exportarPDF } = await import('../lib/plantillaPDF')
        await exportarPDF(doc)
      } else {
        const { exportarExcel } = await import('../lib/plantillaExcel')
        await exportarExcel(doc, validaciones, informe.nombre_archivo)
      }
      guardarEncabezado()
      supabase.from('sc_auditoria').insert({ informe_id: informe.id, accion: `exportar_${tipo}`, detalle: {} })
    } catch (e) {
      setError(`No se pudo generar el archivo: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setGenerando(null)
    }
  }

  return (
    <div className="paso3">
      <div>
        <div className="tabs">
          <button className={vista === 'esf' ? 'activo' : ''} onClick={() => setVista('esf')}>
            Situación financiera
          </button>
          <button className={vista === 'er' ? 'activo' : ''} onClick={() => setVista('er')}>
            Resultados
          </button>
          <button className={vista === 'notas' ? 'activo' : ''} onClick={() => setVista('notas')}>
            Notas ({doc.notas.length})
          </button>
        </div>
        {convencion === 'acreedor_negativo' && (
          <div className="aviso info">
            Los saldos acreedores vienen en negativo en este archivo; se invierte el signo para presentarlos.
          </div>
        )}
        <div className="hoja-doc">
          {vista === 'esf' && (
            <>
              <Cabecera d={doc} titulo="Estado de situación financiera" subtitulo={textoCorte(doc)} />
              <TablaDoc d={doc} filas={doc.esf} />
              <Firmas d={doc} />
            </>
          )}
          {vista === 'er' && (
            <>
              <Cabecera d={doc} titulo="Estado de resultados" subtitulo={textoPeriodoResultados(doc)} />
              <TablaDoc d={doc} filas={doc.er} />
              <Firmas d={doc} />
            </>
          )}
          {vista === 'notas' && (
            <>
              <Cabecera d={doc} titulo="Notas a los estados financieros" subtitulo={textoCorte(doc)} />
              <NotasDoc d={doc} />
            </>
          )}
        </div>
      </div>

      <aside className="lateral">
        <div className="panel">
          <div className="fila entre" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Estado del informe</h3>
            <span className={`etiqueta ${aprobado ? 'ok' : 'alerta'}`}>{aprobado ? 'Aprobado' : 'En revisión'}</span>
          </div>
          {error && <div className="aviso error">{error}</div>}
          <div className="lista-validaciones" style={{ marginBottom: 10 }}>
            <div>
              <span className={`punto ${doc.cuadra ? 'ok' : 'error'}`} />
              <span>{doc.cuadra ? 'Activo = pasivo + patrimonio en los dos años.' : 'El balance no cuadra.'}</span>
            </div>
            <div>
              <span className={`punto ${bloqueado ? 'error' : fallidas.length ? 'alerta' : 'ok'}`} />
              <span>
                {validaciones.length - fallidas.length} de {validaciones.length} validaciones en orden
                {fallidas.length > 0 && (
                  <>
                    {' · '}
                    <button className="sutil" style={{ padding: 0 }} onClick={() => setVerValidaciones((x) => !x)}>
                      {verValidaciones ? 'ocultar' : 'ver detalle'}
                    </button>
                  </>
                )}
              </span>
            </div>
            {(verValidaciones ? fallidas : []).map((v) => (
              <div key={v.codigo} style={{ paddingLeft: 16 }}>
                <span className={`punto ${v.bloqueante ? 'error' : 'alerta'}`} />
                <span>
                  <b>{v.codigo}</b> {v.titulo}. <span className="sutil-texto">{v.detalle}</span>
                </span>
              </div>
            ))}
            {faltan.length > 0 && (
              <div>
                <span className="punto alerta" />
                <span>Encabezado incompleto: falta {faltan.join(', ')}.</span>
              </div>
            )}
          </div>

          {aprobado ? (
            <>
              <p className="sutil-texto" style={{ marginBottom: 8 }}>
                Aprobado el {new Date(informe.aprobado_at!).toLocaleString('es-CO')}. Descarga el informe:
              </p>
              <div className="descargas">
                <button className="marino grande" onClick={() => exportar('pdf')} disabled={!!generando}>
                  {generando === 'pdf' ? 'Generando…' : 'PDF'}
                </button>
                <button className="primario grande" onClick={() => exportar('xlsx')} disabled={!!generando}>
                  {generando === 'xlsx' ? 'Generando…' : 'Excel'}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="primario grande"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={aprobar}
                disabled={bloqueado || aprobando}
              >
                {aprobando ? 'Aprobando…' : 'Aprobar informe'}
              </button>
              <p className="sutil-texto" style={{ marginTop: 8, marginBottom: 0 }}>
                {bloqueado
                  ? 'Hay validaciones que bloquean. Resuélvelas en la clasificación.'
                  : 'Al aprobar se habilitan las descargas en PDF y Excel con la plantilla institucional.'}
              </p>
            </>
          )}
          <button className="sutil" style={{ marginTop: 8 }} onClick={onVolver}>
            ← Volver a la clasificación
          </button>
        </div>

        <details className="seccion" open={faltan.length > 0} style={{ margin: 0 }}>
          <summary>
            Encabezado y firmas
            <span className="resumen">{faltan.length ? `${faltan.length} por completar` : 'completo'}</span>
          </summary>
          <div className="cuerpo">
            <p className="sutil-texto">
              Prellenado con lo que trae el archivo. Los firmantes se recuerdan para esta empresa.
            </p>
            <div className="campos" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {CAMPOS.map(([k, etiqueta, ancho]) => (
                <div className={`campo ${ancho ? 'ancho' : ''}`} key={k}>
                  <label htmlFor={`enc-${k}`}>{etiqueta}</label>
                  <input
                    id={`enc-${k}`}
                    value={encabezado[k]}
                    onChange={(e) => onEncabezado({ ...encabezado, [k]: e.target.value })}
                    onBlur={guardarEncabezado}
                  />
                </div>
              ))}
            </div>
          </div>
        </details>
      </aside>
    </div>
  )
}
