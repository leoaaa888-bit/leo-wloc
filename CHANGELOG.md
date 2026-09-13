# 更新记录

## 1.0.0

首个版本。项目从零建立, 不是对任何既有仓库的修改 —— 详见 [NOTICE.md](NOTICE.md)
与 [docs/provenance.md](docs/provenance.md)。

**代理脚本**

- `dist/wloc.js`: 拦截 `/clls/wloc` 响应, 扫描 protobuf 并替换 WiFi (field 2) 与
  基站 (field 22/24) 条目里的坐标。自带 RFC 1951 DEFLATE 解码器, 不依赖 pako。
  负坐标按 int64 补码编码, 南半球/西半球可用。
- `dist/wloc-settings.js`: 处理 `/wloc-settings/save` 的 save / query / clear。
- 两份脚本均为单文件、零构建、零依赖; 共享运行时块由 `scripts/check.mjs` 校验一致。
- 支持 Shadowrocket / Surge / Loon / Stash / Quantumult X / Egern, 各平台的
  `$done` 约定均有测试覆盖。

**选点页面与解析服务**

- Cloudflare Workers / Pages 双部署, 同一份 `handleRequest`。
- 无 npm 运行时依赖 (去掉了 Hono, 改用原生 fetch handler)。
- 地图选点、地名搜索、Apple/Google/高德/百度链接解析、收藏、当前生效坐标、清除数据。
- 深色模式; `/source` 与页脚提供 AGPL 第 13 条要求的源码入口。

**测试**

- 97 个测试, 全程离线。
- DEFLATE 解码器与 Node zlib 对拍 600 轮。
- 服务端与浏览器两份 GCJ 实现在 400+ 采样点上逐点比对。

**相对上游行为的修正**

- Loon 模块参数由位置式改为具名式 (位置式在 Loon 上实际取不到参数)。
- 平台探测先判 `stash-version` 再判 `surge-version`。
- `bd09mcToBd09` 出口增加值域判断, 越界返回 `null`。
