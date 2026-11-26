-- Digital Vouchers fixes found while testing:
-- 1. Deleting a staff account sets created_by / updated_by to null on the vouchers it touched. The audit
--    trigger recorded that bookkeeping change with the account being deleted as the actor, so the delete
--    failed on the audit foreign key. Those columns are no longer audited (nor is the actor taken from a
--    change that only touches them).
-- 2. Removing a stored voucher image needs read access to its storage row: managers may read the voucher
--    images (the public still reaches them only by their exact public URL; nobody can list them).

create or replace function private.digital_voucher_audit_trigger() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  fields text[];
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'create';
    fields := '{}';
  else
    select coalesce(array_agg(n.key order by n.key), '{}') into fields
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by', 'created_at', 'created_by');
    if cardinality(fields) = 0 then return new; end if;
    verb := case
      when old.archived_at is null and new.archived_at is not null then 'archive'
      when old.archived_at is not null and new.archived_at is null then 'restore'
      when old.published is distinct from new.published then case when new.published then 'publish' else 'unpublish' end
      else 'update' end;
  end if;
  insert into public.digital_voucher_audit (voucher_id, action, changed_fields, actor_id)
  values (new.id, verb, fields, coalesce(new.updated_by, new.created_by));
  return new;
end $$;

create policy digital_voucher_assets_read on storage.objects for select to authenticated
  using (bucket_id = 'digital-voucher-assets' and (select private.can_manage_vouchers()));
