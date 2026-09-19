-- Template importer schema.
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to read top to bottom.
--
-- Model:  templates -> sections -> items -> comments   (plus import_runs -> import_issues)
--   * A template is structured rows, never one HTML blob. HTML lives only inside comments.body_html.
--   * comments.body_raw is the cell exactly as exported and is never edited, so "what did the
--     customer actually give us" is always answerable and an edit can always be compared or reset.
--   * Anything in a row without a first-class column goes to comments.extra (jsonb). Nothing is discarded.

create type comment_type as enum ('info', 'limit', 'defect');

create table templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  source_format   text,
  source_filename text,
  source_sha256   text,
  copied_from     uuid references templates(id) on delete set null,  -- a copy outlives its original
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table sections (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  position    integer not null check (position >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index sections_template_idx on sections (template_id, position);

create table items (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references sections(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  position    integer not null check (position >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index items_section_idx on items (section_id, position);

create table comments (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references items(id) on delete cascade,
  name           text not null check (length(btrim(name)) > 0),
  type           comment_type not null,
  position       integer not null check (position >= 0),
  body_html      text,                       -- editable, sanitized HTML
  body_raw       text,                       -- as exported, never edited
  answer_type    text,
  options        text[] not null default '{}',
  unit_options   text[] not null default '{}',
  category       smallint check (category in (-1, 0, 1)),
  recommendation text,
  default_value  text,
  source_row     integer,
  source_order   integer,
  extra          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index comments_item_idx on comments (item_id, position);

create table import_runs (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid not null references templates(id) on delete cascade,
  source_filename    text,
  source_sha256      text,
  counts             jsonb not null,
  reconciliation     jsonb not null,
  export_limitations jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now()
);

create table import_issues (
  id            uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references import_runs(id) on delete cascade,
  severity      text not null check (severity in ('info', 'warning', 'error')),
  origin        text not null check (origin in ('missing_from_export', 'unsupported_by_importer', 'normalized', 'invalid_input')),
  code          text not null,
  message       text not null,
  source_row    integer,
  section       text,
  item          text,
  comment       text,
  detail        jsonb
);
create index import_issues_run_idx on import_issues (import_run_id);

-- keep updated_at honest
create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger templates_touch before update on templates for each row execute function touch_updated_at();
create trigger sections_touch  before update on sections  for each row execute function touch_updated_at();
create trigger items_touch     before update on items     for each row execute function touch_updated_at();
create trigger comments_touch  before update on comments  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- import_template(payload): the whole import in ONE transaction.
-- If anything is wrong (bad enum value, null name, ...) the function raises and nothing is written,
-- so a failed import can never leave half a template behind.
-- ---------------------------------------------------------------------------------------------
create function import_template(p_payload jsonb) returns uuid
language plpgsql as $$
declare
  v_template uuid;
  v_run      uuid;
  v_section  uuid;
  v_item     uuid;
  s jsonb;
  i jsonb;
begin
  insert into templates (name, source_format, source_filename, source_sha256)
  values (
    p_payload #>> '{template,name}',
    p_payload #>> '{template,sourceFormat}',
    p_payload #>> '{template,sourceFilename}',
    p_payload #>> '{template,sourceSha256}'
  ) returning id into v_template;

  for s in select * from jsonb_array_elements(p_payload -> 'sections') loop
    insert into sections (template_id, name, position)
    values (v_template, s ->> 'name', (s ->> 'position')::int)
    returning id into v_section;

    for i in select * from jsonb_array_elements(s -> 'items') loop
      insert into items (section_id, name, position)
      values (v_section, i ->> 'name', (i ->> 'position')::int)
      returning id into v_item;

      insert into comments (
        item_id, name, type, position, body_html, body_raw, answer_type, options, unit_options,
        category, recommendation, default_value, source_row, source_order, extra
      )
      select
        v_item,
        c ->> 'name',
        (c ->> 'type')::comment_type,
        (c ->> 'position')::int,
        c ->> 'bodyHtml',
        c ->> 'bodyRaw',
        c ->> 'answerType',
        coalesce(array(select jsonb_array_elements_text(c -> 'options')), '{}'),
        coalesce(array(select jsonb_array_elements_text(c -> 'unitOptions')), '{}'),
        nullif(c ->> 'category', '')::smallint,
        c ->> 'recommendation',
        c ->> 'defaultValue',
        (c ->> 'sourceRow')::int,
        (c ->> 'sourceOrder')::int,
        coalesce(c -> 'extra', '{}'::jsonb)
      from jsonb_array_elements(i -> 'comments') c;
    end loop;
  end loop;

  insert into import_runs (template_id, source_filename, source_sha256, counts, reconciliation, export_limitations)
  values (
    v_template,
    p_payload #>> '{run,sourceFilename}',
    p_payload #>> '{run,sourceSha256}',
    p_payload #> '{run,counts}',
    p_payload #> '{run,reconciliation}',
    coalesce(p_payload #> '{run,exportLimitations}', '[]'::jsonb)
  ) returning id into v_run;

  insert into import_issues (import_run_id, severity, origin, code, message, source_row, section, item, comment, detail)
  select
    v_run, x ->> 'severity', x ->> 'origin', x ->> 'code', x ->> 'message',
    (x ->> 'row')::int, x ->> 'section', x ->> 'item', x ->> 'comment', x -> 'detail'
  from jsonb_array_elements(coalesce(p_payload -> 'issues', '[]'::jsonb)) x;

  return v_template;
end $$;

-- ---------------------------------------------------------------------------------------------
-- duplicate_template(source, name): deep copy in ONE statement inside one transaction.
-- Every row gets a new id, so the copy shares nothing with the original: editing or deleting one
-- can never touch the other. Import history stays with the original (it describes that file).
-- ---------------------------------------------------------------------------------------------
create function duplicate_template(p_source uuid, p_name text default null) returns uuid
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
    item_id, name, type, position, body_html, body_raw, answer_type, options, unit_options,
    category, recommendation, default_value, source_row, source_order, extra
  )
  select
    im.new_id, c.name, c.type, c.position, c.body_html, c.body_raw, c.answer_type, c.options, c.unit_options,
    c.category, c.recommendation, c.default_value, c.source_row, c.source_order, c.extra
  from comments c join item_map im on im.old_id = c.item_id;

  return v_new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Access: the browser never talks to the database. Only the server (service role key) does.
-- RLS on + no policies = the public anon key can read and write nothing.
-- ---------------------------------------------------------------------------------------------
alter table templates     enable row level security;
alter table sections      enable row level security;
alter table items         enable row level security;
alter table comments      enable row level security;
alter table import_runs   enable row level security;
alter table import_issues enable row level security;

revoke all on function import_template(jsonb)        from public;
revoke all on function duplicate_template(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function import_template(jsonb) from anon, authenticated';
    execute 'revoke all on function duplicate_template(uuid, text) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function import_template(jsonb) to service_role';
    execute 'grant execute on function duplicate_template(uuid, text) to service_role';
  end if;
end $$;
