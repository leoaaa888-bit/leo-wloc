# 来源、署名与许可证说明

本文件是 Leo WLOC 的溯源记录。它存在的目的有两个: 一是履行 AGPL-3.0 对保留署名和
说明修改的要求, 二是让任何人都能核对「哪些是本项目写的, 哪些不是」。

## 许可证

**Leo WLOC 采用 AGPL-3.0-or-later。** 完整条款见 [LICENSE](LICENSE)。

这不是可选项: 本项目的实现思路来自一个 AGPL-3.0 的上游项目, 派生作品必须继续以
AGPL-3.0 发布。

其中与部署者关系最大的是 **第 13 条**: 如果你把本项目改过之后部署成一个联网服务
(Cloudflare Pages / Workers 都算), 你必须让使用该服务的人能取得你那份修改后的源码。
本项目已经替你做好了这件事:

- 选点页面底部有「源码 (AGPL-3.0)」链接
- `/source` 路由会跳转到仓库

如果你 fork 并修改了代码, **请把 `worker/src/config.js` 里的 `owner` / `repo` 改成你
自己的仓库**, 否则那两个入口指向的仍是本仓库, 你的修改就没有被公开, 不符合第 13 条。

## 上游来源

| 项目 | 关系 | 许可证 |
| --- | --- | --- |
| `Yu9191/wloc` | 实现思路与协议知识的来源。**该仓库及其作者账号已从 GitHub 下线 (查证时对 `/repos/Yu9191/wloc` 与 `/users/Yu9191` 均返回 404)。** | AGPL-3.0 |
| `FFF686868/proxypin-wloc-spoofer` | 上游致谢的更早来源, 最初的 WLOC 响应改写思路 | 见其仓库 |

### 上游代码是怎么核对的

原仓库下线后, 通过多个独立创建的公开镜像交叉校验取得基线。四份镜像的运行时文件
**逐字节相同**, 且其 SHA-256 与镜像方各自发布的完整性记录一致:

| 文件 | SHA-256 |
| --- | --- |
| `dist/wloc.js` | `a1b361e60f0b434585260fb59c65d1ddbe3bff89ace3639f592e7d8af432b3c1` |
| `dist/wloc-settings.js` | `cbff047a7f42055615ee19e208ddfc2ec66833e6f2b75555eac84f1c299a66cf` |
| `LICENSE` | `8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef` |

对应的上游基线提交为 `529fcd841952571e79f40faf2d3e0ef90a7bdfa6`。

上述哈希指的是**上游的文件**, 不是本仓库的文件 —— 本仓库的 `dist/*.js` 是重写的,
哈希自然不同。只有 `LICENSE` 是逐字保留的, 因此哈希相同。

## 本项目做了什么, 没做什么

### 重写的部分

上游从未发布过 `dist/wloc.js` 的源码 —— 它是一份 41 KB 的压缩产物, 根目录的
`.gitignore` 明确排除了 `/src/`、`/package.json`、`/rollup.config.js`。因此本项目的
两份代理脚本是**照着协议行为重新实现的**, 不是对上游产物的修改:

- `dist/wloc.js` — 独立重写。手写 DEFLATE 解压 (上游打包了 pako)、protobuf 扫描与
  改写、坐标扰动、配置优先级、各平台 `$done` 约定。单文件、零构建、零依赖。
- `dist/wloc-settings.js` — 独立重写。
- `worker/src/index.js` — 重写, 去掉了 Hono 依赖, 改用原生 fetch handler。
- `worker/src/page.js` — 重新设计的界面 (深色模式、合并的查找入口、自有品牌)。
- `worker/src/geo.js` / `geo-browser.js` / `parse.js` — 在上游实现的基础上重新组织,
  规则表化、补了值域守卫。
- `modules/*` — 全部重写, 指向本仓库。Loon 模块的 `argument=` 改成具名形式
  (上游的位置式写法在 Loon 上实际取不到参数)。
- `test/`、`worker/test/`、`scripts/check.mjs` — 本项目新增。

### 沿用的事实性内容

下面这些是**客观事实**, 不是可以「另写一遍」的创作。照搬它们不构成抄袭, 但来源应当
说明:

- Apple WLOC 响应的 protobuf 字段编号 (WiFi = 2, 基站 = 22/24, 位置子消息 1/2/3,
  坐标为整数 × 1e8) 与帧结构 —— 逆向所得的协议知识。
- WLOC 的域名集合 (`gs-loc.apple.com`、`gs-loc-cn.apple.com`、`gsp-ssl.ls.apple.com`、
  `bluedot.is.autonavi.com` 及其 `.gds.alibabadns.com` 变体)。
- GCJ-02 偏移算法常数、百度 BD09MC 分段多项式系数表 —— 公开的行业算法。
- 港澳台边界多边形与各地标的 WGS84 实测基准值 (香港 ifc mall、澳门 Galaxy、
  台北 101、深圳万象天地) —— 测量数据。
- 持久化存储的键名 `wloc_settings`, 以及 `/wloc-settings/save` 这个伪造端点路径 ——
  保持一致是为了让从上游迁移过来的用户不丢已保存的坐标。
- 出厂示例坐标 `113.94114, 22.544577` 及其「哨兵值即透传」的语义 —— 同上, 保持
  行为兼容。

### 没有做的事

- 没有声称上游代码由本项目原创。
- 没有沿用上游的图片资源 (`wloc.jpg`)。本项目的 `assets/icon.png` 由
  `scripts/build-icon.mjs` 本地生成。
- 没有沿用上游 README 的品牌信息与文案。
- 没有引用上游的任何运行时资源。`scripts/check.mjs` 会在每次 `npm run check` 时
  验证这一点。

## 上游 README 中的附加声明

上游 README 在其许可证段落写有:

> 本项目采用 AGPL-3.0 许可证。未经授权，禁止将本项目代码用于商业产品或上架应用商店。

此处如实记录该声明。需要指出: 标准 AGPL-3.0 本身并不包含「禁止商业使用」的条款,
额外限制与 GPL 系许可证的关系见 AGPL-3.0 第 7、10、13 节。本项目不主张已获得任何
商业或应用商店分发授权, 也建议使用者不要把本项目用于上述用途。

## 第三方组件

| 组件 | 用途 | 引入方式 | 许可证 |
| --- | --- | --- | --- |
| Leaflet 1.9.4 | 选点页面的地图控件 | 浏览器从 cdnjs 加载, 带 SRI 校验 | BSD-2-Clause |
| ArcGIS World Imagery / Street Map | 卫星、街道底图瓦片 | 浏览器直连 | Esri 服务条款 |
| OpenStreetMap 瓦片 | 标准底图 | 浏览器直连 | ODbL |
| CARTO basemaps | 暗色底图 | 浏览器直连 | CARTO 条款 |
| 高德瓦片 | 国内底图 (GCJ-02) | 浏览器直连 | 高德服务条款 |
| Nominatim | 地名搜索 | 浏览器直连 | OSM 使用政策 |
| Cloudflare Workers / Pages | 托管 | 部署平台 | — |

本项目自身**没有任何 npm 运行时依赖**。`package.json` 的 `dependencies` 为空;
部署只需要 Cloudflare 官方的 `wrangler` CLI。

底图与地名搜索必然来自第三方 —— 任何地图选点工具都是如此。这些服务只在你打开选点
页面时被浏览器直接访问, 坐标本身不经过它们。

## 隐私

- 你选的坐标**不经过本项目的服务器**。写入请求发往 `gs-loc.apple.com/wloc-settings/save`,
  这条请求被你设备上的代理模块就地截下并伪造响应, 从不离开设备。
- `/api/parse` 是纯转发解析: 收到链接 → 跟跳转 → 抠坐标 → 返回 JSON, 不写存储、
  不记日志、不缓存 (`wrangler.jsonc` 里已显式关闭 observability)。
- 收藏列表存在浏览器 `localStorage`, 仅本机可见。
