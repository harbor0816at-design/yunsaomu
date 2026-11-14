-- 云扫墓 V2.0 第 1 阶段迁移：只加列（PRD 3.3 / B-12）
-- 不删行、不改令牌哈希、不轮换旧链接；旧墓按默认值显示。
-- 执行前后请分别运行文件末尾的核对查询，确认墓数量与令牌哈希校验和不变。

alter table public.tombs
  add column if not exists birth_date date,
  add column if not exists birth_precision text,
  add column if not exists death_date date,
  add column if not exists death_precision text,
  add column if not exists grave_address text,
  add column if not exists address_visibility text not null default 'private',
  add column if not exists scene_theme text not null default 'default',
  add column if not exists season_mode text not null default 'auto',
  add column if not exists owner_user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tombs_birth_precision_chk') then
    alter table public.tombs add constraint tombs_birth_precision_chk
      check (birth_precision is null or birth_precision in ('year', 'month', 'day'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tombs_death_precision_chk') then
    alter table public.tombs add constraint tombs_death_precision_chk
      check (death_precision is null or death_precision in ('year', 'month', 'day'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tombs_grave_address_len_chk') then
    alter table public.tombs add constraint tombs_grave_address_len_chk
      check (grave_address is null or char_length(grave_address) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tombs_address_visibility_chk') then
    alter table public.tombs add constraint tombs_address_visibility_chk
      check (address_visibility in ('private', 'link'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tombs_season_mode_chk') then
    alter table public.tombs add constraint tombs_season_mode_chk
      check (season_mode in ('auto', 'spring', 'summer', 'autumn', 'winter'));
  end if;
end $$;

comment on column public.tombs.grave_address is '真实墓地地址（选填）。默认仅建墓人可见，永不进入 OG、分享卡、访客接口、日志和埋点。';
comment on column public.tombs.scene_theme is '墓园场景主题；第 1 阶段只有 default（青山小院）。';
comment on column public.tombs.season_mode is '墓级季节模式：auto 按访客本地日期，或固定季节。';

-- 核对（迁移前后各跑一次，结果应一致）：
-- select count(*) as tombs,
--        md5(string_agg(id || invite_token_hash || admin_token_hash, ',' order by id)) as token_checksum
-- from public.tombs;
