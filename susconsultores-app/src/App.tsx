import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Auth from './components/Auth'
import PasoCargar from './components/PasoCargar'
import PasoClasificar from './components/PasoClasificar'
import PasoEstados from './components/PasoEstados'
import { configuracionCompleta, supabase } from './lib/supabase'
import type { Cuenta, CuentaClasificada, Informe, ReglaMapeo, Rubro } from './lib/types'

type Paso = 1 | 2 | 3

const PASOS: [Paso, string][] = [
  [1, 'Cargar archivo'],
  [2, 'Clasificar cuentas'],
  [3, 'Estados y aprobación'],
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
  const [error, setError] = useState<string | null>(null)

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
    setPaso(1)
  }

  if (!configuracionCompleta) {
    return (
      <div className="app">
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

  return (
    <div className="app">
      <div className="barra">
        <div className="marca">
          Estados Financieros
          <span>SusConsultores · del balance de comprobación al informe</span>
        </div>
        <div className="fila no-print">
          {informe && <button onClick={reiniciar}>Nuevo informe</button>}
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>

      {error && <div className="aviso error">{error}</div>}
      {rubros.length === 0 && !error && (
        <div className="aviso alerta">
          El catálogo de rubros está vacío. Ejecuta la migración de semilla o carga el catálogo
          institucional de SusConsultores.
        </div>
      )}

      <div className="pasos no-print">
        {PASOS.map(([n, etiqueta]) => (
          <div key={n} className={`paso ${paso === n ? 'activo' : ''} ${paso > n ? 'hecho' : ''}`}>
            <b>{n}</b>
            {etiqueta}
          </div>
        ))}
      </div>

      {paso === 1 && (
        <PasoCargar
          onListo={(inf, cts) => {
            setInforme(inf)
            setCuentas(cts)
            setClasificadas([])
            setPaso(2)
          }}
        />
      )}

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

      {paso === 3 && informe && (
        <PasoEstados
          informe={informe}
          clasificadas={clasificadas}
          rubros={rubros}
          onAprobado={setInforme}
          onVolver={() => setPaso(2)}
        />
      )}
    </div>
  )
}
