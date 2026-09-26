import { useMemo, useState } from 'react'
import { construirEstados, formatearMoneda } from '../lib/calculos'
import { exportarLibro, exportarPDF } from '../lib/exportar'
import { supabase } from '../lib/supabase'
import { ejecutarValidaciones, hayBloqueantes } from '../lib/validaciones'
import type { CuentaClasificada, Informe, LineaEstado, Nota, Rubro } from '../lib/types'

interface Props {
  informe: Informe
  clasificadas: CuentaClasificada[]
  rubros: Rubro[]
  onAprobado: (informe: Informe) => void
  onVolver: () => void
}

type Vista = 'esf' | 'er' | 'notas'

function TablaEstado({ lineas, informe }: { lineas: LineaEstado[]; informe: Informe }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Concepto</th>
          <th className="num">Nota</th>
          <th className="num">{informe.periodo_actual}</th>
          {informe.periodo_anterior && <th className="num">{informe.periodo_anterior}</th>}
        </tr>
      </thead>
      <tbody>
        {lineas.map((l, i) => (
          <tr key={i} className={l.tipo === 'total' ? 'total' : l.tipo === 'subtotal' ? 'subtotal' : ''}>
            <td style={{ paddingLeft: l.tipo === 'rubro' ? 24 : 10 }}>{l.etiqueta}</td>
            <td className="num">{l.nota ?? ''}</td>
            <td className="num">{formatearMoneda(l.actual)}</td>
            {informe.periodo_anterior && <td className="num">{formatearMoneda(l.anterior)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Notas({ notas, informe }: { notas: Nota[]; informe: Informe }) {
  return (
    <>
      {notas.map((n) => (
        <div className="nota" key={n.numero}>
          <h3>
            Nota {n.numero} — {n.titulo}
          </h3>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Cuenta</th>
                <th className="num">{informe.periodo_actual}</th>
                {informe.periodo_anterior && <th className="num">{informe.periodo_anterior}</th>}
              </tr>
            </thead>
            <tbody>
              {n.detalle.map((d, i) => (
                <tr key={i}>
                  <td>{d.codigo}</td>
                  <td>{d.nombre}</td>
                  <td className="num">{formatearMoneda(d.actual)}</td>
                  {informe.periodo_anterior && <td className="num">{formatearMoneda(d.anterior)}</td>}
                </tr>
              ))}
              <tr className="subtotal">
                <td></td>
                <td>Total</td>
                <td className="num">{formatearMoneda(n.totalActual)}</td>
                {informe.periodo_anterior && (
                  <td className="num">{formatearMoneda(n.totalAnterior)}</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}

export default function PasoEstados({
  informe,
  clasificadas,
  rubros,
  onAprobado,
  onVolver,
}: Props) {
  const [vista, setVista] = useState<Vista>('esf')
  const [error, setError] = useState<string | null>(null)
  const [aprobando, setAprobando] = useState(false)

  const { notas, esf, er, validaciones, convencion } = useMemo(() => {
    const e = construirEstados(clasificadas, rubros)
    return { ...e, validaciones: ejecutarValidaciones(clasificadas, rubros, e.notas, e.esf, e.er) }
  }, [clasificadas, rubros])

  const bloqueado = hayBloqueantes(validaciones)

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
        detalle: { notas: notas.length, validaciones_ok: validaciones.filter((v) => v.ok).length },
      })
      onAprobado(data as Informe)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAprobando(false)
    }
  }

  const aprobado = informe.estado === 'aprobado'

  return (
    <>
      <div className="panel no-print">
        <h2>3. Revisión y aprobación</h2>
        {error && <div className="aviso error">{error}</div>}
        {convencion === 'acreedor_negativo' && (
          <div className="aviso info">
            Los saldos acreedores vienen en negativo en este archivo; se invierte el signo para
            presentarlos. Verifica el resultado antes de aprobar.
          </div>
        )}
        <table style={{ marginBottom: 14 }}>
          <tbody>
            {validaciones.map((v) => (
              <tr key={v.codigo}>
                <td style={{ width: 70 }}>
                  <span
                    className="etiqueta"
                    style={{
                      background: v.ok ? 'var(--ok-suave)' : v.bloqueante ? 'var(--error-suave)' : 'var(--alerta-suave)',
                      borderColor: v.ok ? '#bfe3ce' : v.bloqueante ? '#f3c6c3' : '#eedba6',
                      color: v.ok ? 'var(--ok)' : v.bloqueante ? 'var(--error)' : 'var(--alerta)',
                    }}
                  >
                    {v.ok ? 'ok' : v.bloqueante ? 'bloquea' : 'revisar'}
                  </span>
                </td>
                <td style={{ width: 60 }} className="sutil-texto">
                  {v.codigo}
                </td>
                <td>{v.titulo}</td>
                <td className="sutil-texto">{v.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="fila">
          <button onClick={onVolver}>Volver a la clasificación</button>
          {aprobado ? (
            <span className="aviso ok" style={{ margin: 0 }}>
              Informe aprobado. Ya puedes exportarlo.
            </span>
          ) : (
            <button className="primario" onClick={aprobar} disabled={bloqueado || aprobando}>
              {aprobando ? 'Aprobando…' : 'Aprobar informe'}
            </button>
          )}
          <button onClick={() => exportarLibro(informe, notas, esf, er)} disabled={!aprobado}>
            Descargar Excel
          </button>
          <button onClick={exportarPDF} disabled={!aprobado}>
            Guardar como PDF
          </button>
        </div>
        {bloqueado && !aprobado && (
          <p className="sutil-texto" style={{ marginTop: 10, marginBottom: 0 }}>
            Hay validaciones que bloquean la aprobación. Resuélvelas en el paso anterior.
          </p>
        )}
      </div>

      <div className="tabs no-print">
        <button className={vista === 'esf' ? 'activo' : ''} onClick={() => setVista('esf')}>
          Balance {informe.periodo_actual}
        </button>
        <button className={vista === 'er' ? 'activo' : ''} onClick={() => setVista('er')}>
          Estado de resultados
        </button>
        <button className={vista === 'notas' ? 'activo' : ''} onClick={() => setVista('notas')}>
          Notas ({notas.length})
        </button>
      </div>

      <div className="panel">
        <div className={vista === 'esf' ? '' : 'no-print'} hidden={vista !== 'esf'}>
          <h2>Estado de situación financiera</h2>
          <TablaEstado lineas={esf} informe={informe} />
        </div>
        <div className={vista === 'er' ? '' : 'no-print'} hidden={vista !== 'er'}>
          <h2>Estado de resultados</h2>
          <TablaEstado lineas={er} informe={informe} />
        </div>
        <div className={vista === 'notas' ? '' : 'no-print'} hidden={vista !== 'notas'}>
          <h2>Notas a los estados financieros</h2>
          <Notas notas={notas} informe={informe} />
        </div>
      </div>
    </>
  )
}
