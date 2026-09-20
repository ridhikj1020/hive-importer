-- 0002: protect the seeded example template, and keep templates.updated_at honest.

-- The live app has no login, so the seeded example must not be deletable by a visitor.
-- Copies are never protected (duplicate_template does not set this column).
alter table templates add column is_protected boolean not null default false;

-- Editing any section, item or comment counts as editing the template.
create function bump_template_updated_at() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'sections' then
    update templates set updated_at = now() where id = new.template_id;
  elsif tg_table_name = 'items' then
    update templates set updated_at = now()
     where id = (select template_id from sections where id = new.section_id);
  else
    update templates set updated_at = now()
     where id = (select s.template_id from items i join sections s on s.id = i.section_id where i.id = new.item_id);
  end if;
  return null;
end $$;

create trigger sections_bump after update on sections for each row execute function bump_template_updated_at();
create trigger items_bump    after update on items    for each row execute function bump_template_updated_at();
create trigger comments_bump after update on comments for each row execute function bump_template_updated_at();
