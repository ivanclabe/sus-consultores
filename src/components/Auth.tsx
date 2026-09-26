import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: correo, password: clave })
    if (error) setError(error.message)
    setCargando(false)
  }

  return (
    <div className="app">
      <div className="login panel">
        <h1>Estados Financieros</h1>
        <p className="sutil-texto">SusConsultores — acceso del equipo contable.</p>
        {error && <div className="aviso error">{error}</div>}
        <form onSubmit={entrar}>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label htmlFor="correo">Correo</label>
            <input id="correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />
          </div>
          <div className="campo" style={{ marginBottom: 14 }}>
            <label htmlFor="clave">Contraseña</label>
            <input id="clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} required />
          </div>
          <button className="primario" type="submit" disabled={cargando} style={{ width: '100%' }}>
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
