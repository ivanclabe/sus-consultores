# Estados Financieros — SusConsultores

Del **balance de comprobación** que exporta Siigo al **formato institucional**
(Notas, Balance/ESF y Estado de Resultados), con revisión del contador antes de
que exista el documento final.

Construido a partir del documento *Requerimientos — Automatización de Estados
Financieros (SusConsultores)*. Cada pieza referencia su RF / RB en los comentarios
del código.

## Principio de diseño

> El modelo propone etiquetas. Los números salen solo del código.

| Actividad | Dónde vive | Naturaleza |
| --- | --- | --- |
| Clasificar TODAS las hojas: tipo, período y destino (año actual / anterior / notas) | `src/lib/clasificarHojas.ts` | determinístico |
| …solo si las reglas dejan algo sin resolver | `src/lib/clasificarConIA.ts` + `supabase/functions/sc-identificar-hojas` | **IA**, el código acepta solo lo verificable |
| Extraer toda la jerarquía de cada balance, con terceros | `src/lib/parseBalance.ts` | determinístico |
| Extraer las notas del archivo (detalle, subtotales, totales) | `src/lib/parseNotas.ts` | determinístico |
| Validar la extracción (E-01 a E-13) | `src/lib/procesarLibro.ts` | determinístico |
| Mapeo por memoria de la empresa y por prefijo PUC | `src/lib/clasificar.ts` | determinístico |
| Clasificación de lo que las reglas no cubren | `supabase/functions/sc-clasificar-cuentas` | **IA** |
| Verificación de la salida del modelo contra el catálogo | la misma función, al final | determinístico |
| Sumas por nota, rubro y periodo | `src/lib/calculos.ts` | determinístico |
| Validaciones de cuadre | `src/lib/validaciones.ts` | determinístico |
| Excel y PDF | `src/lib/exportar.ts` | determinístico |

El modelo **no recibe saldos**: solo código y nombre de cuenta. No puede alterar
una cifra ni aunque quisiera.

## Stack

- **React 18 + TypeScript + Vite** — lectura del Excel, extracción, cálculos,
  validaciones y exportación ocurren en el navegador; el archivo no se sube.
- **Supabase** — Auth (login), Postgres (tablas con prefijo `sc_`) y dos Edge
  Functions de IA: `sc-identificar-hojas` y `sc-clasificar-cuentas`.
- **Claude** (`claude-sonnet-5`) — solo dentro de esas funciones, para que la
  llave de Anthropic nunca llegue al navegador.

## Puesta en marcha

```bash
npm install
npm run dev
```

1. `.env.local` ya trae la URL y la llave publicable del proyecto Supabase.
2. El secreto `ANTHROPIC_API_KEY` ya está configurado en Supabase → *Edge
   Functions* → *Secrets*. Sin él, la clasificación por reglas funciona y la
   parte de IA devuelve un error explicando qué falta.
3. Entrar con un usuario de Supabase Auth del proyecto.

Las migraciones de `supabase/migrations/` ya están aplicadas.

## Flujo

1. **Cargar** — lo primero es **clasificar todas las hojas**, antes de extraer
   una sola cuenta. Cada hoja recibe un tipo (balance de comprobación, estado
   financiero ya armado, notas, otra) y los períodos que declara. Los años se
   leen del contenido (`DIC/31/2025`, `31 de diciembre de 2025`), ignorando la
   fecha de proceso del reporte, y del nombre de la hoja: ninguno está en el
   código. El período actual es el balance de comprobación más reciente; el
   anterior, el inmediatamente previo (ambos se pueden cambiar).
   Cada hoja termina en **un solo destino**: año actual, año anterior, notas,
   no se usa, o **revisión requerida** si no se puede decidir con certeza (una
   hoja sin período, dos balances del mismo año). Nada se asigna en silencio:
   lo pendiente bloquea hasta que el usuario lo resuelva, y si algo queda sin
   resolver se consulta a la IA. La tabla de clasificación permite cambiar el
   destino de cualquier hoja.
   El resultado son **tres tabs**, con el año en el nombre: *Año actual*, *Año
   anterior* y *Notas*. Cada período se extrae solo de sus propias hojas (si
   viene repartido en varias, se unen por cuenta y se valida que no se
   contradigan), y todas las hojas de notas se procesan juntas. Debajo, las
   validaciones de clasificación (C-01 a C-07) y de extracción (E-02 a E-14).
2. **Clasificar** — memoria → reglas → modelo. La tabla abre filtrada por lo que
   necesita atención: sin clasificar y propuestas de baja confianza. Cada cambio
   del contador se guarda como memoria de esa empresa y no se vuelve a preguntar.
3. **Estados y aprobación** — notas, ESF y ER calculados, con el tablero de
   validaciones. El balance incluye el resultado del periodo dentro del
   patrimonio. Las validaciones bloqueantes impiden aprobar. Aprobado el
   informe, se descarga el Excel o se imprime a PDF.

## Decisiones que tomó el código y conviene revisar con el cliente

| Tema | Qué hace hoy | Por qué hay que confirmarlo |
| --- | --- | --- |
| **Catálogo de rubros y notas** | Semilla basada en el PUC, 19 notas, con *Ingresos operacionales* en la nota 13, en las tablas `sc_rubros` y `sc_reglas_mapeo` | Es la pregunta abierta **P1**. El catálogo real de SusConsultores debe reemplazar las filas con `origen = 'semilla_provisional'` |
| **Periodo comparativo** | Sale de la hoja de balance del año anterior, dentro del mismo libro | Resuelto con el archivo de 2025-2024. Un libro sin esa hoja se bloquea con un mensaje claro |
| **Notas del archivo** | Se extraen y se muestran tal como vienen, en el orden del archivo | Los totales generales ("TOTAL ACTIVOS") quedan dentro del bloque de la nota anterior, igual que en el Excel |
| **Signo de los saldos acreedores** | Se detecta del archivo: si pasivo + patrimonio + ingresos suma negativo, se invierte para presentar | El cliente nunca habló de convención de signos |
| **Formato de presentación** | Layout propio, legible e imprimible | **No es** el formato institucional de SusConsultores. Falta el archivo de referencia para replicarlo (RF-022) |
| **Archivo fuente** | No se almacena; solo lo que se extrae de él | RNF-12 quedó por confirmar; esta es la opción más conservadora |
| **Memoria de correcciones** | Activa, por empresa | En el documento es fase futura. Se puede desactivar borrando `sc_mapeos_confirmados` |
| **Datos a un servicio externo** | Códigos y nombres de cuenta viajan a la API de Anthropic; los saldos no | Pregunta **P4**: la autorización es del cliente, no del equipo técnico |

## Base de datos

| Tabla | Para qué |
| --- | --- |
| `sc_empresas` | Empresas cliente |
| `sc_rubros` | Catálogo institucional: rubro, estado, sección, número de nota |
| `sc_reglas_mapeo` | Mapeo determinístico por prefijo PUC (gana el más largo) |
| `sc_informes` | Una corrida = una empresa + un periodo, con la clasificación de todas las hojas (`identificacion`) y el reporte de extracción |
| `sc_cuentas` | Toda la jerarquía de los dos años, con terceros (`nivel = 'tercero'`), padre, NIT y celda de origen de cada saldo. `es_hoja` marca el nivel más profundo, que es lo que alimenta las notas. Un saldo `null` significa que la cuenta no existe ese año |
| `sc_notas_archivo` | Las notas tal como vienen en las hojas de notas del Excel, con su hoja de origen |
| `sc_notas_archivo_lineas` | Sus líneas: detalle, subtotales, totales, encabezados, con los dos años y la celda de origen |
| `sc_clasificaciones` | Rubro de cada cuenta, con origen, confianza y estado |
| `sc_mapeos_confirmados` | Memoria de lo que el contador ya decidió |
| `sc_validaciones` | Resultado de las validaciones al aprobar |
| `sc_auditoria` | Quién cargó, clasificó y aprobó |

RLS activo en todas, con acceso para usuarios autenticados.

## Pruebas

```bash
npx esbuild scripts/prueba-nucleo.ts --bundle --platform=node --format=cjs \
  --outfile=/tmp/prueba.cjs && node /tmp/prueba.cjs
```

197 comprobaciones sobre un libro sintético con la forma exacta del de Siigo,
generado **para cualquier año** y corrido con 2024/2025 y con 2025/2026 sin
cambiar una línea. Incluye las trampas del archivo real: varios balances de
años distintos, "Procesado en" con el año siguiente, encabezados truncados
(`SUBCUENT`, `SUBAUXIL`), grupo 25 + cuenta 25, terceros, fila de totales,
cuentas que existen un solo año, notas que empiezan en B2 con años como fechas
y encabezado de años repetido a mitad de hoja, el formato de notas de otra
empresa (número y título en celdas separadas, años como texto) y los casos de
error: falta la hoja del año anterior, dos hojas del mismo año, falta la hoja
de notas, celda con `#REF!`. También la clasificación: hoja sin período que
debe ir a revisión, período repartido en dos hojas (que debe dar exactamente las
mismas cuentas que en una sola), varias hojas de notas, una hoja asignada a un
período que no le corresponde y el cambio de período anterior.

Para ver qué extrae la app de un archivo real, sin escribir nada:

```bash
npx esbuild scripts/diagnostico-archivo.ts --bundle --platform=node \
  --format=cjs --outfile=/tmp/diag.cjs && node /tmp/diag.cjs "archivo.xlsx"
```

## Lo que no está

Fuera de alcance del MVP, tal como se definió en el documento: integración
directa con Siigo, procesamiento por lotes, redacción del texto narrativo de las
notas, gestión de usuarios y roles, edición del catálogo desde la interfaz
(hoy se administra en la base de datos) e historial de informes emitidos.
