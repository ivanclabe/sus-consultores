# Instalación en la cuenta de Supabase del cliente

SQL listos para dejar la base de datos de **Estados Financieros** en un proyecto
de Supabase nuevo y propio de SusConsultores. Todos se pueden ejecutar más de una
vez sin borrar datos.

| Archivo | Qué hace |
| --- | --- |
| `00_instalacion_completa.sql` | Los pasos 01 a 06 juntos, en una sola transacción. **Es el que normalmente se usa.** |
| `01_tablas_base.sql` | Tablas de la app, índices y seguridad por filas (RLS) |
| `02_catalogo_semilla.sql` | Catálogo provisional de 19 rubros y 34 reglas por código PUC |
| `03_extraccion_completa.sql` | Jerarquía completa de cuentas, terceros y notas del archivo |
| `04_notas_por_hoja.sql` | Hoja de origen de cada nota |
| `05_encabezado_informe.sql` | Encabezado del informe (razón social, NIT, firmantes) |
| `06_configuracion_ia.sql` | Llave de Claude cifrada en Vault, modelo y administradores |
| `07_primer_administrador.sql` | Registra al usuario que podrá configurar la IA (editar el correo) |
| `99_verificar.sql` | Comprueba la instalación: todas las filas deben decir `OK` |
| `generar.sh` | Regenera 00–06 desde `supabase/migrations` si cambian las migraciones |

## Paso a paso

**1. Crear el proyecto.** En [supabase.com](https://supabase.com) → *New project*.
Región sugerida: *South America (São Paulo)*. Guarda la contraseña de la base.

**2. Crear las tablas.** *SQL Editor* → *New query* → pega el contenido de
`00_instalacion_completa.sql` → *Run*. Debe terminar sin errores (los avisos
`NOTICE ... skipping` son normales).

**3. Crear los usuarios.** *Authentication* → *Users* → *Add user* → *Create new user*,
con correo y contraseña, marcando *Auto Confirm User*. Uno por persona del equipo.

**4. Cerrar el registro público.** *Authentication* → *Sign In / Providers* →
desactiva *Allow new users to sign up*. La app es interna: solo entran los
usuarios creados en el paso 3.

**5. Nombrar al administrador.** Abre `07_primer_administrador.sql`, cambia
`administrador@empresa.com` por el correo de quien configurará la IA y ejecútalo.

**6. Publicar las funciones de IA** (desde la carpeta del repositorio, con la CLI de Supabase):

```bash
npx supabase login
npx supabase functions deploy sc-identificar-hojas sc-clasificar-cuentas sc-probar-ia --project-ref <REF_DEL_PROYECTO>
```

El `REF_DEL_PROYECTO` es el código que aparece en la URL del proyecto
(`https://<ref>.supabase.co`). Las tres funciones usan `functions/_shared/configIA.ts`.

*Sin terminal (desde el panel):* la carpeta `funciones/` tiene las tres funciones
en un solo archivo cada una. Para cada archivo: *Edge Functions* → *Deploy a new
function* → *Via Editor* → nombre exacto de la función (`sc-identificar-hojas`,
`sc-clasificar-cuentas`, `sc-probar-ia`) → borra el código de ejemplo, pega el
contenido del archivo → *Deploy function*. Deja activa la verificación de JWT.
Para actualizar una función ya creada: ábrela → pestaña *Code* → pega la versión
nueva → *Deploy updates*.

**7. Conectar la app.** En *Project Settings* → *API Keys* copia la *Project URL*
y la *Publishable key*, y crea `.env.local` en la raíz del repositorio (y en el
servidor donde se publique):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Vuelve a compilar o desplegar la app para que tome estos valores.

**8. Configurar Claude desde la app.** Entra con el usuario administrador →
**⚙ Configuración** → pega la llave de Anthropic (se crea en
[console.anthropic.com](https://console.anthropic.com/settings/keys) → *API Keys*),
elige el modelo y pulsa **Probar conexión**.

**9. Verificar.** Ejecuta `99_verificar.sql` en el *SQL Editor*: las 10 filas deben
decir `OK`.

## Para tener en cuenta

- **La llave de Claude no se pega en ningún SQL.** Se registra desde la app y queda
  cifrada en Vault; ni la app ni el navegador pueden leerla de vuelta. Como
  respaldo, las funciones también aceptan el secreto `ANTHROPIC_API_KEY`
  (*Edge Functions* → *Secrets*).
- **El catálogo de rubros es provisional** (`origen = 'semilla_provisional'`).
  Debe reemplazarse por el catálogo y la numeración de notas reales de
  SusConsultores.
- **Seguridad:** todas las tablas tienen RLS y solo los usuarios autenticados las
  ven. Por eso es importante el paso 4. Solo los administradores (paso 5) pueden
  cambiar la llave o el modelo.
- **Probado** sobre la imagen oficial `supabase/postgres` 17: instalación repetida
  dos veces sin errores, verificación en `OK`, y permisos comprobados (un usuario
  normal no puede cambiar ni leer la llave; el servidor sí puede leerla).
