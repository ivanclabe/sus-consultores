import { useMemo, useState } from 'react'
import { clasificar, normalizarNombre, requiereRevision, type MapeoMemoria } from '../lib/clasificar'
import { supabase } from '../lib/supabase'
import type {
  Clasificacion,
  Cuenta,
  CuentaClasificada,
  EstadoClasificacion,
  Informe,
  ReglaMapeo,
  Rubro,
} from '../lib/types'

interface Props {
  informe: Informe
  cuentas: Cuenta[]
  clasificadas: CuentaClasificada[]
  rubros: Rubro[]
  reglas: ReglaMapeo[]
  onClasificadas: (c: CuentaClasificada[]) => void
  onContinuar: () => void
}

type Filtro = 'revisar' | 'todas' | 'ia' | 'sin'

export default function PasoClasificar({
  informe,
  cuentas,
  clasificadas,
  rubros,
  reglas,
  onClasificadas,
  onContinuar,
}: Props) {
  const [corriendo, setCorriendo] = useState(false)
  const [usarIA, setUsarIA] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nota, setNota] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('revisar')

  const hojas = useMemo(() => cuentas.filter((c) => c.es_hoja), [cuentas])

  async function ejecutar() {
    setCorriendo(true)
    setError(null)
    setNota(null)
    try {
      let memoria: MapeoMemoria[] = []
      if (informe.empresa_id) {
        const { data } = await supabase
          .from('sc_mapeos_confirmados')
          .select('codigo, nombre_norm, rubro_codigo')
          .eq('empresa_id', informe.empresa_id)
        memoria = (data ?? []) as MapeoMemoria[]
      }

      const { propuestas, consultadasIA } = await clasificar({
        cuentas: hojas,
        rubros,
        reglas,
        memoria,
        usarIA,
      })

      const filas = propuestas.map((p) => ({ informe_id: informe.id, ...p }))
      const { data, error } = await supabase
        .from('sc_clasificaciones')
        .upsert(filas, { onConflict: 'cuenta_id' })
        .select('*')
      if (error) throw error

      const porCuenta = new Map(((data ?? []) as Clasificacion[]).map((c) => [c.cuenta_id, c]))
      onClasificadas(
        hojas
          .filter((c) => porCuenta.has(c.id))
          .map((c) => ({ ...c, clasificacion: porCuenta.get(c.id)! })),
      )

      await supabase.from('sc_auditoria').insert({
        informe_id: informe.id,
        accion: 'clasificar',
        detalle: { total: propuestas.length, consultadas_ia: consultadasIA, uso_ia: usarIA },
      })
      const recordadas = propuestas.filter((p) => p.origen === 'memoria').length
      setNota(
        `${propuestas.length} cuentas clasificadas` +
          (recordadas ? `; ${recordadas} ya las habías confirmado antes para esta empresa` : '') +
          (consultadasIA ? `; ${consultadasIA} necesitaron al modelo` : '') +
          '.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCorriendo(false)
    }
  }

  async function actualizar(
    fila: CuentaClasificada,
    cambio: { rubro_codigo?: string | null; estado?: EstadoClasificacion },
  ) {
    const rubro = cambio.rubro_codigo !== undefined ? cambio.rubro_codigo : fila.clasificacion.rubro_codigo
    const estado: EstadoClasificacion = cambio.estado ?? (rubro ? 'confirmada' : 'sin_clasificar')

    const { data, error } = await supabase
      .from('sc_clasificaciones')
      .update({
        rubro_codigo: rubro,
        estado,
        origen: 'manual',
        confianza: 1,
        razon: 'Ajustada por el contador.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', fila.clasificacion.id)
      .select('*')
      .single()
    if (error) {
      setError(error.message)
      return
    }

    // Memoria por empresa: lo confirmado no se vuelve a preguntar.
    if (estado === 'confirmada' && rubro && informe.empresa_id) {
      await supabase.from('sc_mapeos_confirmados').upsert(
        {
          empresa_id: informe.empresa_id,
          codigo: fila.codigo,
          nombre_norm: normalizarNombre(fila.nombre),
          rubro_codigo: rubro,
        },
        { onConflict: 'empresa_id,codigo,nombre_norm' },
      )
    }

    onClasificadas(
      clasificadas.map((c) => (c.id === fila.id ? { ...c, clasificacion: data as Clasificacion } : c)),
    )
  }

  async function confirmarTodas() {
    const pendientes = clasificadas.filter(
      (c) => c.clasificacion.estado === 'propuesta' && c.clasificacion.rubro_codigo,
    )
    if (pendientes.length === 0) return
    const { error } = await supabase
      .from('sc_clasificaciones')
      .update({ estado: 'confirmada', updated_at: new Date().toISOString() })
      .in('id', pendientes.map((c) => c.clasificacion.id))
    if (error) {
      setError(error.message)
      return
    }
    onClasificadas(
      clasificadas.map((c) =>
        pendientes.some((p) => p.id === c.id)
          ? { ...c, clasificacion: { ...c.clasificacion, estado: 'confirmada' } }
          : c,
      ),
    )
  }

  const visibles = clasificadas.filter((c) => {
    if (filtro === 'todas') return true
    if (filtro === 'ia') return c.clasificacion.origen === 'ia'
    if (filtro === 'sin') return c.clasificacion.rubro_codigo === null
    return requiereRevision(c.clasificacion)
  })

  const sinClasificar = clasificadas.filter((c) => c.clasificacion.rubro_codigo === null).length
  const porRevisar = clasificadas.filter((c) => requiereRevision(c.clasificacion)).length
  const confirmadas = clasificadas.filter((c) => c.clasificacion.estado === 'confirmada').length

  return (
    <>
      <div className="panel">
        <h2>2. Clasificación de cuentas</h2>
        <p className="sutil-texto">
          Primero mandan las cuentas que ya confirmaste antes para esta empresa, después las
          reglas por código PUC. Solo lo que sobra llega al modelo, y el modelo nunca ve saldos:
          propone una etiqueta, tú decides.
        </p>
        {error && <div className="aviso error">{error}</div>}
        {nota && <div className="aviso ok">{nota}</div>}

        {clasificadas.length === 0 ? (
          <div className="fila">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={usarIA}
                onChange={(e) => setUsarIA(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Usar el modelo para lo que las reglas no cubran
            </label>
            <button className="primario" onClick={ejecutar} disabled={corriendo}>
              {corriendo ? 'Clasificando…' : `Clasificar ${hojas.length} cuentas`}
            </button>
          </div>
        ) : (
          <>
            <div className="metricas">
              <div className="metrica">
                <b>{clasificadas.length}</b>
                <span>cuentas</span>
              </div>
              <div className="metrica">
                <b style={{ color: sinClasificar ? 'var(--error)' : 'var(--ok)' }}>
                  {sinClasificar}
                </b>
                <span>sin clasificar</span>
              </div>
              <div className="metrica">
                <b style={{ color: porRevisar ? 'var(--alerta)' : 'var(--ok)' }}>{porRevisar}</b>
                <span>para revisar</span>
              </div>
              <div className="metrica">
                <b>{confirmadas}</b>
                <span>confirmadas</span>
              </div>
            </div>

            <div className="fila no-print">
              <div className="tabs" style={{ marginBottom: 0, flex: 1 }}>
                {([
                  ['revisar', `Para revisar (${porRevisar})`],
                  ['sin', `Sin clasificar (${sinClasificar})`],
                  ['ia', 'Propuestas del modelo'],
                  ['todas', `Todas (${clasificadas.length})`],
                ] as [Filtro, string][]).map(([f, etiqueta]) => (
                  <button
                    key={f}
                    className={filtro === f ? 'activo' : ''}
                    onClick={() => setFiltro(f)}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
              <button onClick={confirmarTodas}>Confirmar todas las propuestas</button>
              <button className="primario" onClick={onContinuar}>
                Ver estados financieros
              </button>
            </div>
          </>
        )}
      </div>

      {clasificadas.length > 0 && (
        <div className="panel">
          {visibles.length === 0 ? (
            <div className="aviso ok">Nada pendiente en este filtro.</div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cuenta</th>
                    <th className="num">Saldo</th>
                    <th>Rubro del formato</th>
                    <th>Origen</th>
                    <th>Razón</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((c) => (
                    <tr key={c.id} className={requiereRevision(c.clasificacion) ? 'revisar' : ''}>
                      <td>{c.codigo}</td>
                      <td>{c.nombre}</td>
                      <td className="num">{c.saldo_actual === null ? '—' : c.saldo_actual.toLocaleString('es-CO')}</td>
                      <td>
                        <select
                          value={c.clasificacion.rubro_codigo ?? ''}
                          onChange={(e) =>
                            actualizar(c, { rubro_codigo: e.target.value || null })
                          }
                        >
                          <option value="">— sin clasificar —</option>
                          {rubros.map((r) => (
                            <option key={r.codigo} value={r.codigo}>
                              {r.nota_numero ? `${r.nota_numero}. ` : ''}
                              {r.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`etiqueta ${c.clasificacion.origen}`}>
                          {c.clasificacion.origen}
                          {c.clasificacion.origen === 'ia' && c.clasificacion.confianza !== null
                            ? ` ${Math.round(c.clasificacion.confianza * 100)}%`
                            : ''}
                        </span>{' '}
                        {c.clasificacion.estado === 'propuesta' && (
                          <span className="etiqueta pendiente">sin confirmar</span>
                        )}
                      </td>
                      <td className="sutil-texto">{c.clasificacion.razon}</td>
                      <td>
                        {c.clasificacion.estado === 'excluida' ? (
                          <button
                            className="sutil"
                            onClick={() => actualizar(c, { estado: 'propuesta' })}
                          >
                            incluir
                          </button>
                        ) : (
                          <button
                            className="sutil"
                            onClick={() =>
                              actualizar(c, { estado: 'excluida', rubro_codigo: null })
                            }
                            title="No se presenta en el informe, pero sigue contando en las validaciones"
                          >
                            no presentar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
