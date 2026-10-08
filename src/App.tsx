import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Auth from './components/Auth'
import Configuracion from './components/Configuracion'
import PasoCargar from './components/PasoCargar'
import PasoClasificar from './components/PasoClasificar'
import PasoEstados from './components/PasoEstados'
import type { Encabezado } from './lib/empresaArchivo'
import { configuracionCompleta, supabase } from './lib/supabase'
import type { Cuenta, CuentaClasificada, Informe, ReglaMapeo, Rubro } from './lib/types'

type Paso = 1 | 2 | 3

const PASOS: [Paso, string, string][] = [
  [1, 'Cargar archivo', 'Hojas, períodos y empresa'],
  [2, 'Clasificar cuentas', 'Reglas, memoria e IA'],
  [3, 'Revisar y exportar', 'Estados, notas, PDF y Excel'],
]

export default function App() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [listo, setListo] = useState(false)
  const [paso, setPaso] = useState<Paso>(1)
  const [rubros, setRubros] = useState<Rubro[]>([])
  const [reglas, setReglas] = useState<ReglaMapeo[]>([])
  const [informe, setInforme] = useState<Informe | null>(null)
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [clasificadas, setClasificadas] = useState<CuentaClasificada[]>([])
  const [encabezado, setEncabezado] = useState<Encabezado | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Cambia con «Nuevo informe» para empezar el paso 1 desde cero.
  const [intento, setIntento] = useState(0)
  const [enConfiguracion, setEnConfiguracion] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setListo(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // El catálogo institucional vive en la base: se edita ahí, no en el código.
  useEffect(() => {
    if (!sesion) return
    ;(async () => {
      const [r, g] = await Promise.all([
        supabase.from('sc_rubros').select('*').eq('activo', true).order('orden'),
        supabase.from('sc_reglas_mapeo').select('prefijo, rubro_codigo, prioridad, activo'),
      ])
      if (r.error || g.error) {
        setError(r.error?.message ?? g.error?.message ?? null)
        return
      }
      setRubros((r.data ?? []) as Rubro[])
      setReglas((g.data ?? []) as ReglaMapeo[])
    })()
  }, [sesion])

  function reiniciar() {
    setInforme(null)
    setCuentas([])
    setClasificadas([])
    setEncabezado(null)
    setIntento((i) => i + 1)
    setPaso(1)
  }

  if (!configuracionCompleta) {
    return (
      <div className="login-fondo">
        <div className="panel login">
          <h1>Falta configuración</h1>
          <p>
            Copia <code>.env.example</code> a <code>.env.local</code> y completa{' '}
            <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
      </div>
    )
  }

  if (!listo) return <div className="app sutil-texto">Cargando…</div>
  if (!sesion) return <Auth />

  // Se puede volver a cualquier paso ya alcanzado; avanzar solo con los botones de cada paso.
  const alcanzado: Paso = !informe ? 1 : clasificadas.length === 0 ? 2 : 3

  return (
    <>
      <header className="encabezado-app">
        <div className="contenido">
          <div className="logo">
            <div className="logo-marca">SC</div>
            <div>
              <b>Estados Financieros</b>
              <span>SusConsultores · del balance de comprobación al informe</span>
            </div>
          </div>
          <div className="fila" style={{ alignItems: 'center' }}>
            <span className="usuario">{sesion.user.email}</span>
            {informe && !enConfiguracion && <button onClick={reiniciar}>Nuevo informe</button>}
            <button onClick={() => setEnConfiguracion((v) => !v)} aria-pressed={enConfiguracion}>
              {enConfiguracion ? 'Volver al informe' : '⚙ Configuración'}
            </button>
            <button onClick={() => supabase.auth.signOut()}>Salir</button>
          </div>
        </div>
      </header>

      {enConfiguracion && (
        <main className="app">
          <Configuracion usuarioId={sesion.user.id} onCerrar={() => setEnConfiguracion(false)} />
        </main>
      )}

      {/* El flujo sigue montado mientras se ve la configuración: no se pierde el informe en curso. */}
      <main className="app" hidden={enConfiguracion}>
        {error && <div className="aviso error">{error}</div>}
        {rubros.length === 0 && !error && (
          <div className="aviso alerta">
            El catálogo de rubros está vacío. Ejecuta la migración de semilla o carga el catálogo
            institucional de SusConsultores.
          </div>
        )}

        <nav className="pasos">
          {PASOS.map(([n, etiqueta, ayuda]) => (
            <button
              key={n}
              className={`paso ${paso === n ? 'activo' : ''} ${paso > n || (alcanzado > n && paso !== n) ? 'hecho' : ''}`}
              disabled={n > alcanzado || n === paso}
              onClick={() => setPaso(n)}
            >
              <span className="num">{paso > n || (alcanzado > n && paso !== n) ? '✓' : n}</span>
              <span>
                <b>{etiqueta}</b>
                <small>{ayuda}</small>
              </span>
            </button>
          ))}
        </nav>

        {/* El paso 1 se mantiene montado: al volver, el archivo y su análisis siguen ahí. */}
        <div hidden={paso !== 1}>
          <PasoCargar
            key={intento}
            informe={informe}
            onListo={(inf, cts, enc) => {
              setInforme(inf)
              setCuentas(cts)
              setClasificadas([])
              setEncabezado(enc)
              setPaso(2)
            }}
          />
        </div>

        {paso === 2 && informe && (
          <PasoClasificar
            informe={informe}
            cuentas={cuentas}
            clasificadas={clasificadas}
            rubros={rubros}
            reglas={reglas}
            onClasificadas={setClasificadas}
            onContinuar={() => setPaso(3)}
          />
        )}

        {paso === 3 && informe && encabezado && (
          <PasoEstados
            informe={informe}
            clasificadas={clasificadas}
            rubros={rubros}
            encabezado={encabezado}
            onEncabezado={setEncabezado}
            onAprobado={setInforme}
            onVolver={() => setPaso(2)}
          />
        )}
      </main>
    </>
  )
}
