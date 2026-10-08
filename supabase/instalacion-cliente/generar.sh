#!/usr/bin/env bash
# Regenera los SQL de instalación a partir de supabase/migrations.
# Uso: bash supabase/instalacion-cliente/generar.sh
set -euo pipefail
cd "$(dirname "$0")"
M=../migrations

encabezado() {
  cat <<TXT
-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso $1: $2
-- Origen: supabase/migrations/$3
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

TXT
}

copiar() { # numero, titulo, archivo, destino
  { encabezado "$1" "$2" "$3"; cat "$M/$3"; echo; } > "$4"
}

copiar 01 "Tablas base, catálogo vacío y seguridad (RLS)" 20260922120000_sc_init.sql            01_tablas_base.sql
copiar 02 "Catálogo semilla de rubros y reglas PUC"       20260922120100_sc_catalogo_semilla.sql 02_catalogo_semilla.sql
copiar 03 "Extracción completa (jerarquía, terceros, notas del archivo)" 20260923090000_sc_extraccion_completa.sql 03_extraccion_completa.sql
copiar 04 "Hoja de origen de cada nota"                   20260925090000_sc_notas_hoja.sql       04_notas_por_hoja.sql
copiar 05 "Encabezado del informe y firmantes por empresa" 20261008090000_sc_encabezado.sql      05_encabezado_informe.sql
{
  encabezado 06 "Configuración de la IA (llave en Vault y modelo)" 20261008100000_sc_configuracion_ia.sql
  echo "-- Vault viene instalado en todos los proyectos de Supabase; esto solo lo asegura."
  echo "create extension if not exists supabase_vault with schema vault;"
  echo
  cat "$M/20261008100000_sc_configuracion_ia.sql"
  echo
} > 06_configuracion_ia.sql

# Todo en uno, en una sola transacción: o se instala completo o no se instala nada.
{
  cat <<TXT
-- ============================================================================
-- SusConsultores · Estados Financieros — INSTALACIÓN COMPLETA (pasos 01 a 06)
-- Pegar en Supabase > SQL Editor > New query y ejecutar (Run).
-- Va en una sola transacción: si algo falla, no queda nada a medias.
-- Después: 07_primer_administrador.sql y 99_verificar.sql.
-- ============================================================================

begin;

TXT
  for f in 01_tablas_base.sql 02_catalogo_semilla.sql 03_extraccion_completa.sql \
           04_notas_por_hoja.sql 05_encabezado_informe.sql 06_configuracion_ia.sql; do
    echo "-- >>> $f"
    cat "$f"
    echo
  done
  echo "commit;"
} > 00_instalacion_completa.sql

echo "Listo: $(ls -1 *.sql | wc -l | tr -d ' ') archivos SQL en $(pwd)"
