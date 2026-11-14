# 后端变更（未部署）

线上 Supabase 项目 `yunsaomu`（ap-southeast-1）目前运行 `api` v1。本目录是第 1 阶段需要的变更，**尚未应用到线上**。

## 1. 立即可做、风险最低：关闭自动过审（PRD Q7 / A1-16）

不改代码，只在 Supabase 后台 Edge Functions → Secrets 设置：

```
YUNSAOMU_AUTO_APPROVE_MS=0
```

设置后新留言一直保持「审核中」，直到建墓人通过。已公开的历史留言不受影响。

## 2. 只加列迁移

`migrations/20261114_v2_phase1_add_columns.sql`：给 `tombs` 加 `birth_date / birth_precision / death_date / death_precision / grave_address / address_visibility / scene_theme / season_mode / owner_user_id`，全部可空或带默认值。不删行、不改令牌哈希。

执行前后各跑一次文件末尾的核对查询，墓数量与 `token_checksum` 应一致。

## 3. 部署 `api` v2

`functions/api/index.ts`。与 v1 接口完全兼容（网页版无需改动），新增：

- 生、卒日期可单独填写，支持年 / 年月 / 年月日；旧的 `birthYear / deathYear` 仍然接受。
- `graveAddress` 写入库，默认私密，只在管理令牌的响应里以 `admin.graveAddress` 返回；访客响应、分享接口都不含地址。
- `sceneTheme`、`seasonMode` 写入并在 `tomb` 里返回。
- 碑式缺省 `qingshi`；自动过审默认关闭。
- 鞠躬记录 10 秒后过期，不在场景中常驻。

必须先执行迁移再部署 v2（v2 会写新列）。回滚：重新部署 v1 即可，新列保留不影响 v1。

## 4. 上线前（国内部署）

小程序正式版的接口域名必须是 ICP 备案过的域名。可选方案见 `docs/发布清单.md` 第 3 节。
