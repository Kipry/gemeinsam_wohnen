-- Beleg-Fotos an Ausgaben
--
-- "Was war da alles drin?" — ein Foto vom Kassenbon beendet die Diskussion,
-- ohne dass jemand einzelne Positionen abtippen muss.
--
-- Privater Bucket; Dateien liegen unter <household_id>/<expense_id>-<zeit>.jpg.
-- Zugriff haben nur Mitglieder der WG aus dem ersten Pfadsegment.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/webp']);

alter table public.expenses add column receipt_path text;

-- Erstes Pfadsegment als uuid lesen — ungültige Pfade liefern null statt Fehler
create function public.receipt_household(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

create policy "Belege der eigenen WG ansehen"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_household_member(public.receipt_household(name)));

create policy "Belege in die eigene WG hochladen"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_household_member(public.receipt_household(name)));

create policy "Belege der eigenen WG ersetzen"
  on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and public.is_household_member(public.receipt_household(name)))
  with check (bucket_id = 'receipts' and public.is_household_member(public.receipt_household(name)));

create policy "Belege der eigenen WG löschen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_household_member(public.receipt_household(name)));
