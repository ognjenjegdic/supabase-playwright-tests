-- Run once in a dedicated Supabase test project's SQL Editor.
-- No existing tables are dropped or overwritten.
begin;
create table public.pw_bookings (
  id uuid primary key,
  firstname text not null,
  lastname text not null,
  totalprice integer not null check (totalprice >= 0),
  depositpaid boolean not null default false,
  checkin date not null,
  checkout date not null,
  additionalneeds text,
  constraint valid_booking_dates check (checkout > checkin)
);

alter table public.pw_bookings enable row level security;
-- This suite uses a backend secret key (service_role), not anonymous access.
-- No public or authenticated-user policies are installed.
revoke all on public.pw_bookings from anon, authenticated;
grant select, insert, update, delete on public.pw_bookings to service_role;
commit;
notify pgrst, 'reload schema';
