-- 017_soft_delete.sql
-- Soft-delete for leads + quotes so deletions are recoverable. Deleting now sets
-- deleted_at (the row stays, hidden from normal views); a Trash page restores it
-- (clear deleted_at) or purges it for good. Safe to re-run.

alter table clients add column if not exists deleted_at timestamptz;
alter table clients add column if not exists deleted_by uuid;
alter table quotes  add column if not exists deleted_at timestamptz;
alter table quotes  add column if not exists deleted_by uuid;

create index if not exists idx_clients_deleted on clients(deleted_at);
create index if not exists idx_quotes_deleted  on quotes(deleted_at);
