-- ============================================================================
-- SusConsultores · Estados Financieros — Paso 07: primer administrador
--
-- El administrador es quien puede registrar la llave de Claude y elegir el modelo
-- desde la app (⚙ Configuración). Los demás usuarios solo la ven.
--
-- Antes de ejecutar:
--   1. Crea el usuario en Supabase > Authentication > Users > Add user
--      (marca "Auto Confirm User").
--   2. Cambia el correo de abajo por el de ese usuario.
-- Para agregar más administradores, vuelve a ejecutarlo con otro correo.
-- ============================================================================

do $$
declare
  v_correo text := 'administrador@empresa.com';   -- ← CAMBIAR
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_correo);
  if v_id is null then
    raise exception 'No existe un usuario con el correo %. Créalo primero en Authentication > Users.', v_correo;
  end if;
  insert into public.sc_administradores (user_id) values (v_id) on conflict do nothing;
  raise notice 'Administrador registrado: %', v_correo;
end $$;

-- Administradores actuales
select u.email, a.created_at as administrador_desde
  from public.sc_administradores a
  join auth.users u on u.id = a.user_id
 order by a.created_at;
