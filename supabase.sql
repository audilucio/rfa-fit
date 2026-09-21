-- RFA.FIT — BANCO E SEGURANÇA SUPABASE
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  color text,
  price numeric(10,2) not null default 0,
  description text,
  images jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  id boolean primary key default true,
  whatsapp_number text not null default '5573982484011',
  instagram_url text not null default 'https://instagram.com/SEU_INSTAGRAM',
  updated_at timestamptz not null default now(),
  constraint one_settings check (id = true)
);

insert into public.store_settings (id) values (true)
on conflict (id) do nothing;

alter table public.products enable row level security;
alter table public.store_settings enable row level security;

-- Loja pública: somente produtos ativos e configurações da loja.
drop policy if exists "public read active products" on public.products;
create policy "public read active products" on public.products
for select using (active = true);

drop policy if exists "public read store settings" on public.store_settings;
create policy "public read store settings" on public.store_settings
for select using (true);

-- Painel: qualquer usuário autenticado pode administrar.
-- Crie apenas a conta administrativa no Authentication do Supabase.
drop policy if exists "authenticated manage products" on public.products;
create policy "authenticated manage products" on public.products
for all to authenticated using (true) with check (true);

drop policy if exists "authenticated manage settings" on public.store_settings;
create policy "authenticated manage settings" on public.store_settings
for all to authenticated using (true) with check (true);

-- Storage para fotos de produtos.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public view product images" on storage.objects;
create policy "public view product images" on storage.objects
for select using (bucket_id = 'product-images');

drop policy if exists "authenticated upload product images" on storage.objects;
create policy "authenticated upload product images" on storage.objects
for insert to authenticated with check (bucket_id = 'product-images');

drop policy if exists "authenticated update product images" on storage.objects;
create policy "authenticated update product images" on storage.objects
for update to authenticated using (bucket_id = 'product-images') with check (bucket_id = 'product-images');

drop policy if exists "authenticated delete product images" on storage.objects;
create policy "authenticated delete product images" on storage.objects
for delete to authenticated using (bucket_id = 'product-images');

-- Produtos iniciais da RFA.FIT.
insert into public.products (slug,name,color,price,description,images,active) values
('perola','Biquíni Cortininha Pérola','Pérola',119.90,
 'Modelo cortininha de amarrar, com detalhes em pedraria que valorizam a peça. Ajustável no corpo e pensado para acompanhar dias de praia, piscina e lazer.',
 '["assets/produtos/perola-01.jpg","assets/produtos/perola-02.jpg","assets/produtos/perola-03.jpg"]',true),
('terra','Biquíni Cortininha Terra','Terra',119.90,
 'Cortininha de amarrar em tom Terra, com pedraria no centro do top e nas laterais da calcinha. Uma proposta marcante e versátil.',
 '["assets/produtos/terra-01.jpg","assets/produtos/terra-02.jpg","assets/produtos/terra-03.jpg","assets/produtos/terra-04.jpg","assets/produtos/terra-05.jpg"]',true),
('verde','Biquíni Cortininha Verde','Verde',119.90,
 'Cortininha de amarrar em Verde, com detalhes em pedraria. As amarrações permitem ajuste e deixam a peça com visual leve e personalizado.',
 '["assets/produtos/verde-01.jpg","assets/produtos/verde-02.jpg","assets/produtos/verde-03.jpg","assets/produtos/verde-04.jpg"]',true),
('preto','Biquíni Cortininha Preto','Preto',119.90,
 'Cortininha de amarrar em Preto, com detalhes de pedraria e acabamento delicado. Uma opção atemporal para compor diferentes momentos de verão.',
 '["assets/produtos/preto-01.jpg","assets/produtos/preto-02.jpg","assets/produtos/preto-03.jpg"]',true)
on conflict (slug) do update set name=excluded.name,color=excluded.color,price=excluded.price,description=excluded.description,images=excluded.images;
