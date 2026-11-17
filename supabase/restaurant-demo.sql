-- One-time migration for the restaurant practice sandbox.
-- Existing bookings remain intact. Run this whole file once.
begin;

create table public.restaurants (
  id uuid primary key,
  name text not null unique,
  currency text not null default 'USD' check (currency = 'USD'),
  active boolean not null default true
);
create table public.menu_items (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id),
  name text not null,
  category text not null check (category in ('main', 'side', 'drink')),
  price_cents integer not null check (price_cents > 0),
  available boolean not null default true,
  unique (restaurant_id, name)
);
create table public.coupons (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id),
  code text not null,
  percent_off integer not null check (percent_off between 1 and 100),
  minimum_cents integer not null default 0 check (minimum_cents >= 0),
  active boolean not null default true,
  expires_at timestamptz not null,
  unique (restaurant_id, code)
);
create table public.orders (
  id uuid primary key,
  order_number bigint generated always as identity unique,
  restaurant_id uuid not null references public.restaurants(id),
  coupon_id uuid references public.coupons(id),
  status text not null check (status in ('paid', 'payment_failed')),
  currency text not null check (currency = 'USD'),
  subtotal_cents integer not null check (subtotal_cents > 0),
  discount_cents integer not null check (discount_cents >= 0 and discount_cents <= subtotal_cents),
  total_cents integer not null check (total_cents = subtotal_cents - discount_cents),
  created_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  item_name text not null,
  quantity integer not null check (quantity between 1 and 20),
  unit_price_cents integer not null check (unit_price_cents > 0),
  line_total_cents integer generated always as (quantity * unit_price_cents) stored,
  unique (order_id, menu_item_id)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null check (status in ('approved', 'declined')),
  provider text not null default 'simulated' check (provider = 'simulated'),
  card_brand text not null default 'Visa',
  card_last4 text not null default '4242' check (card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now()
);
create index menu_items_restaurant_idx on public.menu_items(restaurant_id);
create index orders_restaurant_idx on public.orders(restaurant_id);
-- order_items.order_id and payments.order_id are indexed by their unique constraints.

-- All amounts are integer USD cents. Prices/names are snapshotted at checkout.
-- A single RPC transaction creates an order, its items, and a simulated payment.
create function public.place_order(
  p_order_id uuid,
  p_restaurant_id uuid,
  p_items jsonb,
  p_coupon_code text default null,
  p_test_card text default 'test_card_approved'
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_currency text;
  v_items jsonb;
  v_count integer;
  v_subtotal integer;
  v_discount integer := 0;
  v_coupon public.coupons%rowtype;
  v_order public.orders%rowtype;
  v_approved boolean;
begin
  if p_order_id is null then raise exception 'order_id is required'; end if;
  if p_test_card is null or p_test_card not in ('test_card_approved', 'test_card_declined') then
    raise exception 'Use test_card_approved or test_card_declined; real card data is not accepted';
  end if;
  select currency into v_currency from public.restaurants where id = p_restaurant_id and active;
  if not found then raise exception 'Restaurant is missing or inactive'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;
  if jsonb_array_length(p_items) not between 1 and 20 then raise exception 'Provide 1 to 20 menu items'; end if;
  -- Validate quantity before the recordset's integer cast, which can round JSON numbers.
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x) <> 'object'
      or coalesce(jsonb_typeof(x->'quantity'), '') <> 'number'
      or coalesce(x->>'quantity', '') !~ '^([1-9]|1[0-9]|20)$'
      or coalesce(x->>'menu_item_id', '') = ''
  ) then raise exception 'Each item needs a menu_item_id and an integer quantity from 1 to 20'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer)
    group by menu_item_id having count(*) > 1
  ) then raise exception 'Duplicate menu items are not allowed; increase quantity instead'; end if;

  select count(*), sum(m.price_cents * x.quantity),
    jsonb_agg(jsonb_build_object('menu_item_id', m.id, 'item_name', m.name,
      'quantity', x.quantity, 'unit_price_cents', m.price_cents))
    into v_count, v_subtotal, v_items
  from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity integer)
  join public.menu_items m on m.id = x.menu_item_id
  where m.restaurant_id = p_restaurant_id and m.available;
  if v_count <> jsonb_array_length(p_items) then
    raise exception 'Menu item is missing, unavailable, or belongs to another restaurant';
  end if;

  if nullif(trim(p_coupon_code), '') is not null then
    select * into v_coupon from public.coupons
    where restaurant_id = p_restaurant_id and code = upper(trim(p_coupon_code))
      and active and expires_at > now();
    if not found then raise exception 'Coupon is invalid, expired, or belongs to another restaurant'; end if;
    if v_subtotal < v_coupon.minimum_cents then raise exception 'Coupon minimum order value is not met'; end if;
    -- Round down to a whole cent, consistently for API and database comparisons.
    v_discount := floor(v_subtotal::numeric * v_coupon.percent_off / 100)::integer;
  end if;

  v_approved := p_test_card = 'test_card_approved';
  insert into public.orders(id, restaurant_id, coupon_id, status, currency,
    subtotal_cents, discount_cents, total_cents)
  values(p_order_id, p_restaurant_id, v_coupon.id,
    case when v_approved then 'paid' else 'payment_failed' end,
    v_currency, v_subtotal, v_discount, v_subtotal - v_discount)
  returning * into v_order;
  insert into public.order_items(order_id, menu_item_id, item_name, quantity, unit_price_cents)
    select p_order_id, x.menu_item_id, x.item_name, x.quantity, x.unit_price_cents
    from jsonb_to_recordset(v_items) as x(menu_item_id uuid, item_name text, quantity integer, unit_price_cents integer);
  insert into public.payments(order_id, amount_cents, status)
    values(p_order_id, v_order.total_cents, case when v_approved then 'approved' else 'declined' end);
  return to_jsonb(v_order);
end;
$$;

-- Backend practice API only. No anonymous restaurant/order access is enabled.
alter table public.restaurants enable row level security;
alter table public.menu_items enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
revoke all on public.restaurants, public.menu_items, public.coupons, public.orders,
  public.order_items, public.payments from anon, authenticated;
grant select, insert, update, delete on public.restaurants, public.menu_items, public.coupons,
  public.orders, public.order_items, public.payments to service_role;
grant usage, select on sequence public.orders_order_number_seq to service_role;
revoke all on function public.place_order(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, uuid, jsonb, text, text) to service_role;

-- Fictional demo menus and prices; names are used for practice only.
insert into public.restaurants(id, name) values
 ('10000000-0000-4000-8000-000000000001', 'McDonald''s Demo'),
 ('10000000-0000-4000-8000-000000000002', 'KFC Demo'),
 ('10000000-0000-4000-8000-000000000003', 'Burger King Demo');
insert into public.menu_items(id, restaurant_id, name, category, price_cents, available) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Classic Burger','main',599,true),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Fries','side',249,true),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Cola','drink',199,true),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Seasonal Burger','main',799,false),
 ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','Chicken Burger','main',649,true),
 ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','Chicken Bites','side',399,true),
 ('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','Lemonade','drink',199,true),
 ('20000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000003','Grilled Burger','main',699,true),
 ('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000003','Onion Rings','side',299,true),
 ('20000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000003','Cola','drink',199,true);
insert into public.coupons(id, restaurant_id, code, percent_off, minimum_cents, active, expires_at) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','SAVE10',10,1000,true,'2099-01-01'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','CHICKEN15',15,1000,true,'2099-01-01'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','KING10',10,1000,true,'2099-01-01'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','EXPIRED',20,0,true,'2020-01-01'),
 ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','DISABLED',20,0,false,'2099-01-01');
commit;
notify pgrst, 'reload schema';
