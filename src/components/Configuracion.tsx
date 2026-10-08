import { useEffect, useState } from 'react'
import {
  CLAVE_VALIDA,
  MODELOS,
  MODELO_VALIDO,
  borrarClave,
  esAdministrador,
  guardarClave,
  guardarModelo,
  leerConfiguracion,
  probarConexion,
  type ConfiguracionIA,
  type ResultadoPrueba,
} from '../lib/configuracionIA'

interface Props {
  usuarioId: string
  onCerrar: () => void
}

const OTRO = '__otro__'
const fecha = (s: string | null) => (s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '')

export default function Configuracion({ usuarioId, onCerrar }: Props) {
  const [config, setConfig] = useState<ConfiguracionIA | null>(null)
  const [cargando, setCargando] = useState(true)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [admin, setAdmin] = useState(false)
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [eleccion, setEleccion] = useState('')
  const [personalizado, setPersonalizado] = useState('')
  const [ocupado, setOcupado] = useState<'clave' | 'borrar' | 'modelo' | 'probar' | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null)

  async function recargar() {
    const [c, a] = await Promise.all([leerConfiguracion(), esAdministrador()])
    setConfig(c)
    setSinMigracion(c === null)
    setAdmin(a)
    if (c) {
      const conocido = MODELOS.some((m) => m.id === c.modelo)
      setEleccion(conocido ? c.modelo : OTRO)
      setPersonalizado(conocido ? '' : c.modelo)
    }
    setCargando(false)
  }

  useEffect(() => {
    recargar()
  }, [])

  const modeloElegido = eleccion === OTRO ? personalizado.trim() : eleccion
  const modeloCambio = !!config && modeloElegido !== config.modelo
  const claveValida = CLAVE_VALIDA.test(clave.trim())

  async function accion(tipo: NonNullable<typeof ocupado>, fn: () => Promise<void>, exito: string) {
    setOcupado(tipo)
    setMensaje(null)
    try {
      await fn()
      setMensaje({ tipo: 'ok', texto: exito })
      await recargar()
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) })
    } finally {
      setOcupado(null)
    }
  }

  async function probar() {
    setOcupado('probar')
    setPrueba(null)
    setMensaje(null)
    try {
      setPrueba(await probarConexion(modeloCambio && MODELO_VALIDO.test(modeloElegido) ? modeloElegido : undefined))
    } catch (e) {
      setPrueba({ ok: false, fuente: 'ninguna', modelo: modeloElegido, mensaje: e instanceof Error ? e.message : String(e) })
    } finally {
      setOcupado(null)
    }
  }

  if (cargando) return <div className="panel sutil-texto">Cargando configuración…</div>

  return (
    <>
      <div className="panel">
        <div className="panel-titulo">
          <div>
            <h2>Configuración</h2>
            <p className="sutil-texto">
              Inteligencia artificial que usa la app para identificar hojas y clasificar las cuentas que las reglas no
              cubren. El modelo nunca recibe saldos.
            </p>
          </div>
          <button onClick={onCerrar}>← Volver al informe</button>
        </div>

        {sinMigracion && (
          <div className="aviso alerta">
            La base de datos todavía no tiene la configuración de IA. Aplica la migración{' '}
            <code>supabase/migrations/20261008100000_sc_configuracion_ia.sql</code> y despliega las funciones{' '}
            <code>sc-identificar-hojas</code>, <code>sc-clasificar-cuentas</code> y <code>sc-probar-ia</code>. Mientras
            tanto la app sigue usando el secreto <code>ANTHROPIC_API_KEY</code> del servidor.
          </div>
        )}
        {!sinMigracion && !admin && (
          <div className="aviso info">
            Solo un administrador de SusConsultores puede cambiar la llave o el modelo. Puedes ver la configuración
            actual.
          </div>
        )}
        {mensaje && <div className={`aviso ${mensaje.tipo}`}>{mensaje.texto}</div>}
      </div>

      {!sinMigracion && config && (
        <div className="rejilla rejilla-2">
          <div className="panel" style={{ marginBottom: 0 }}>
            <h3>Llave de Anthropic (Claude)</h3>
            <div className={`tarjeta ${config.clave_final ? 'ok' : 'alerta'}`} style={{ margin: '10px 0 14px' }}>
              <span className="rotulo">Estado</span>
              <span className="valor">
                {config.clave_final ? `Configurada · sk-ant-…${config.clave_final}` : 'Sin llave desde la app'}
              </span>
              <span className="sutil-texto">
                {config.clave_final
                  ? `Actualizada el ${fecha(config.clave_actualizada_at)}${config.clave_actualizada_por === usuarioId ? ' por ti' : ''}.`
                  : 'Se usa el secreto ANTHROPIC_API_KEY del servidor, si existe.'}
              </span>
            </div>

            {admin && (
              <>
                <div className="campo" style={{ marginBottom: 8 }}>
                  <label htmlFor="clave">{config.clave_final ? 'Reemplazar llave' : 'Nueva llave'}</label>
                  <div className="fila" style={{ flexWrap: 'nowrap' }}>
                    <input
                      id="clave"
                      type={verClave ? 'text' : 'password'}
                      value={clave}
                      onChange={(e) => setClave(e.target.value)}
                      placeholder="sk-ant-api03-…"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button className="sutil" onClick={() => setVerClave((v) => !v)} type="button">
                      {verClave ? 'Ocultar' : 'Ver'}
                    </button>
                  </div>
                  {clave && !claveValida && (
                    <span className="sutil-texto" style={{ color: 'var(--error)' }}>
                      Debe empezar por sk-ant- y copiarse completa.
                    </span>
                  )}
                </div>
                <div className="fila">
                  <button
                    className="primario"
                    disabled={!claveValida || !!ocupado}
                    onClick={() =>
                      accion('clave', async () => {
                        await guardarClave(clave)
                        setClave('')
                        setVerClave(false)
                      }, 'Llave guardada. Usa «Probar conexión» para verificarla.')
                    }
                  >
                    {ocupado === 'clave' ? 'Guardando…' : 'Guardar llave'}
                  </button>
                  {config.clave_final && (
                    <button
                      disabled={!!ocupado}
                      onClick={() => {
                        if (window.confirm('¿Quitar la llave? La IA dejará de funcionar si el servidor no tiene ANTHROPIC_API_KEY.')) {
                          accion('borrar', borrarClave, 'Llave eliminada.')
                        }
                      }}
                    >
                      {ocupado === 'borrar' ? 'Quitando…' : 'Quitar llave'}
                    </button>
                  )}
                </div>
              </>
            )}
            <p className="sutil-texto" style={{ marginTop: 12, marginBottom: 0 }}>
              Se crea en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>{' '}
              → API Keys. Se guarda cifrada en Supabase Vault y no vuelve a mostrarse: ni la app ni el navegador pueden
              leerla. El consumo se cobra a la cuenta de Anthropic de la empresa.
            </p>
          </div>

          <div className="panel" style={{ marginBottom: 0 }}>
            <h3>Modelo</h3>
            <p className="sutil-texto">En uso: <b>{config.modelo}</b>{config.updated_at && ` · desde el ${fecha(config.updated_at)}`}</p>
            <div className="lista-modelos">
              {MODELOS.map((m) => (
                <label key={m.id} className={`opcion-modelo ${eleccion === m.id ? 'elegida' : ''}`}>
                  <input
                    type="radio"
                    name="modelo"
                    value={m.id}
                    checked={eleccion === m.id}
                    disabled={!admin}
                    onChange={() => setEleccion(m.id)}
                  />
                  <span>
                    <b>{m.nombre}</b> <code>{m.id}</code>
                    <small>{m.descripcion}</small>
                  </span>
                </label>
              ))}
              <label className={`opcion-modelo ${eleccion === OTRO ? 'elegida' : ''}`}>
                <input type="radio" name="modelo" checked={eleccion === OTRO} disabled={!admin} onChange={() => setEleccion(OTRO)} />
                <span style={{ flex: 1 }}>
                  <b>Otro identificador</b>
                  <input
                    value={personalizado}
                    disabled={!admin || eleccion !== OTRO}
                    onChange={(e) => setPersonalizado(e.target.value)}
                    placeholder="claude-…"
                    style={{ marginTop: 4 }}
                  />
                </span>
              </label>
            </div>
            {eleccion === OTRO && personalizado && !MODELO_VALIDO.test(personalizado.trim()) && (
              <p className="sutil-texto" style={{ color: 'var(--error)' }}>El identificador debe empezar por claude-.</p>
            )}
            {admin && (
              <button
                className="primario"
                style={{ marginTop: 10 }}
                disabled={!modeloCambio || !MODELO_VALIDO.test(modeloElegido) || !!ocupado}
                onClick={() => accion('modelo', () => guardarModelo(modeloElegido), `Modelo cambiado a ${modeloElegido}.`)}
              >
                {ocupado === 'modelo' ? 'Guardando…' : 'Guardar modelo'}
              </button>
            )}
          </div>
        </div>
      )}

      {!sinMigracion && config && admin && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="fila entre">
            <div>
              <h3 style={{ margin: 0 }}>Probar la conexión</h3>
              <p className="sutil-texto" style={{ margin: 0 }}>
                Hace una llamada mínima a Anthropic con la llave guardada
                {modeloCambio && MODELO_VALIDO.test(modeloElegido) ? ` y el modelo elegido (${modeloElegido}, aún sin guardar)` : ` y el modelo ${config.modelo}`}.
              </p>
            </div>
            <button onClick={probar} disabled={!!ocupado}>
              {ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}
            </button>
          </div>
          {prueba && (
            <div className={`aviso ${prueba.ok ? 'ok' : 'error'}`} style={{ marginTop: 12, marginBottom: 0 }}>
              <b>{prueba.ok ? 'Funciona.' : 'No funcionó.'}</b> {prueba.mensaje}{' '}
              <span className="sutil-texto">
                Modelo {prueba.modelo} · llave{' '}
                {prueba.fuente === 'app' ? 'configurada en la app' : prueba.fuente === 'secreto' ? 'del secreto del servidor' : 'ninguna'}
                {prueba.latencia_ms !== undefined && ` · ${(prueba.latencia_ms / 1000).toFixed(1)} s`}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  )
}
