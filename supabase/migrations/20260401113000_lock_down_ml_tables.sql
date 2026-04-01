revoke all on table public.ml_connections from anon;
revoke all on table public.ml_connections from authenticated;
revoke all on table public.ml_orders from anon;
revoke all on table public.ml_orders from authenticated;

drop policy if exists "Allow all on ml_connections" on public.ml_connections;
drop policy if exists "Allow all on ml_orders" on public.ml_orders;

create policy "No direct client access to ml_connections"
on public.ml_connections
for all
to anon, authenticated
using (false)
with check (false);

create policy "No direct client access to ml_orders"
on public.ml_orders
for all
to anon, authenticated
using (false)
with check (false);
