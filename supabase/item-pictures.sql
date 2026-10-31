-- Run once after schema.sql, features.sql, and search-jobs.sql.
begin;
alter table public.wish_items
  add column image_url text check (image_url is null or (length(image_url)<=2048 and image_url like 'https://%')),
  add column image_source_url text check (image_source_url is null or (length(image_source_url)<=2048 and image_source_url like 'https://%')),
  add column image_mode text not null default 'auto' check (image_mode in ('auto','custom','none')),
  add constraint item_picture_mode check (image_mode<>'none' or (image_url is null and image_source_url is null));
-- Existing item RLS restricts updates to owners/editors; sharing remains read-only.
grant update(image_url,image_source_url,image_mode) on public.wish_items to authenticated;
commit;
