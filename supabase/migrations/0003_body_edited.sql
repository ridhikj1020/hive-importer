-- 0003: remember which comments had their text edited, so the editor can say so and offer
-- "put back the exported text" only where it means something.

alter table comments add column body_edited boolean not null default false;

-- duplicate_template must carry the flag across, or a copy would forget what was edited.
create or replace function duplicate_template(p_source uuid, p_name text default null) returns uuid
language plpgsql as $$
declare
  v_src templates%rowtype;
  v_new uuid := gen_random_uuid();
begin
  select * into v_src from templates where id = p_source;
  if not found then
    raise exception 'template % not found', p_source using errcode = 'P0002';
  end if;

  insert into templates (id, name, source_format, source_filename, source_sha256, copied_from)
  values (
    v_new,
    coalesce(nullif(btrim(p_name), ''), 'Copy of ' || v_src.name),
    v_src.source_format, v_src.source_filename, v_src.source_sha256, p_source
  );

  with sec_map as materialized (
    select id as old_id, gen_random_uuid() as new_id from sections where template_id = p_source
  ), new_sections as (
    insert into sections (id, template_id, name, position)
    select m.new_id, v_new, s.name, s.position
    from sections s join sec_map m on m.old_id = s.id
    returning id
  ), item_map as materialized (
    select i.id as old_id, gen_random_uuid() as new_id, m.new_id as new_section_id
    from items i join sec_map m on m.old_id = i.section_id
  ), new_items as (
    insert into items (id, section_id, name, position)
    select im.new_id, im.new_section_id, i.name, i.position
    from items i join item_map im on im.old_id = i.id
    returning id
  )
  insert into comments (
    item_id, name, type, position, body_html, body_raw, body_edited, answer_type, options, unit_options,
    category, recommendation, default_value, source_row, source_order, extra
  )
  select
    im.new_id, c.name, c.type, c.position, c.body_html, c.body_raw, c.body_edited, c.answer_type, c.options, c.unit_options,
    c.category, c.recommendation, c.default_value, c.source_row, c.source_order, c.extra
  from comments c join item_map im on im.old_id = c.item_id;

  return v_new;
end $$;
