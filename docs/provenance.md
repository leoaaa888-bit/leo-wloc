# 上游溯源记录

这一页记录本项目动手之前, 对上游做的审计过程和核对方法。核查日期 **2026-09-13**。

法律层面的署名与许可证说明在 [../NOTICE.md](../NOTICE.md), 这里只讲**事实是怎么查
到的**。

## 上游已下线

对 `Yu9191/wloc` 的审计从一个意外开始 —— 它不存在了:

```
GET api.github.com/repos/Yu9191/wloc   -> 404 Not Found
GET api.github.com/users/Yu9191        -> 404 Not Found
GET github.com/Yu9191/wloc             -> 404
```

不只是仓库, **作者账号本身**也返回 404。这只能证明「查证当时公开不可访问」, 无法
确定是作者主动删除、改名, 还是被平台处理。

## 用四份独立镜像还原基线

在 GitHub 上搜到多个声明来源的镜像 / 社区恢复版, 取其中四份做交叉校验:

| 仓库 | 自述 |
| --- | --- |
| `1137182119/wloc` | "Self-hosted mirror of Yu9191/wloc — preserved for archival purposes." |
| `Cafe2o4/wloc` | 描述字串与原项目一致 |
| `xepes0/wloc` | "社区维护版: 基于 Yu9191/wloc 恢复, 保留原作者历史与许可证" |
| `tyiag13/wloc-backup` | "Apple WLOC 自用备份: 独立订阅、脚本与 Cloudflare Worker" |

**四份镜像的运行时文件逐字节相同:**

| 文件 | SHA-256 |
| --- | --- |
| `dist/wloc.js` | `a1b361e60f0b434585260fb59c65d1ddbe3bff89ace3639f592e7d8af432b3c1` |
| `dist/wloc-settings.js` | `cbff047a7f42055615ee19e208ddfc2ec66833e6f2b75555eac84f1c299a66cf` |
| `worker/src/parse.js` | `ec15772ae0c4bf3a…` |
| `worker/src/page.js` | `e66c3d6645ce329f…` |
| `worker/src/gcj-browser.js` | `d9a5f3dad1fda247…` |
| `LICENSE` | `8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef` |

各镜像的 `modules/*` **不同** —— 每份都把 `script-path` 改成了自己的仓库地址。这正是
预期行为, 也反过来说明其余文件的一致不是巧合。

其中 `xepes0/wloc` 附带了一份独立发布的完整性记录
(`docs/upstream-integrity.json`), 声明上游基线提交为
`529fcd841952571e79f40faf2d3e0ef90a7bdfa6`。上表中三个文件的哈希与该记录**精确吻合**,
而这份记录是在本次核查之前、由第三方发布的。

### 关于 SourceForge 上的 `apple-wloc.mirror`

有一个 SourceForge 项目 `apple-wloc.mirror` 看起来也是同一个项目的镜像。**本次核查
未能直接读取它** —— 该站点全部路径 (包括各个下载镜像主机和 REST API) 都返回
Cloudflare 人机校验页, 命令行客户端无法通过。用一个虚构的项目名做对照, 返回的状态码
与页面大小几乎相同, 因此那些响应**不能**用来判断项目是否存在。

间接证据指向 `tyiag13/wloc-backup`: 该 SourceForge 项目的发行记录里有 `v1.0.0` 与
`v1.1.0` 两个版本, 而在检索到的 113 个 wloc 相关仓库中, **只有 `tyiag13/wloc-backup`
同时具备这两个 tag**。该仓库的内容已按上表核对, 与基线一致。

即便如此, 这只是**推断**, 不是直接验证。

## 关键发现: 上游从未发布过代理脚本的源码

`dist/wloc.js` 是一份 **41 180 字节、两行、最长单行 41 137 字符**的压缩产物。

上游根目录的 `.gitignore` 明确排除了构建来源:

```
/src/
/package.json
/package-lock.json
/rollup.config.js
```

`xepes0` 的溯源文档也记录: 在 46 条可达提交里没有找到完整的 `wloc.js` 源码、根
`package.json` 或 Rollup 工程; 历史上曾有一份 `src/wloc-settings.js`, 但在提交
`28e21ba` 被删除, 且只是旧版片段, 无法据以重建当前产物。

这件事有两层影响:

1. **对本项目**: 「独立实现 `wloc.js`」不是形式要求 —— 根本没有源码可以修改, 只能
   照着协议行为重写。本项目正是这么做的。
2. **对上游自身**: AGPL-3.0 要求分发时提供「对应源码」。只发布压缩产物而排除构建
   来源, 与该义务存在张力。本项目不对此作法律评价, 只如实记录。

为了搞清楚协议行为, 本次审计把那份压缩产物反压缩后逐行读过 —— 读的是**行为**
(protobuf 字段编号、帧结构、各平台 `$done` 约定), 写的是新代码。

## 本项目相对上游的行为差异

审计中发现并在重写时修正的几处:

| 项 | 上游 | 本项目 |
| --- | --- | --- |
| Loon 模块参数 | `argument=[{longitude},{latitude},…]` 位置式。Loon 传进来是一串逗号分隔的裸值, 脚本按键名取参数**全部取不到**, 模块参数实际不生效 | 改为具名式 `argument=longitude={longitude}&…` |
| 平台探测顺序 | 先判 `surge-version` 再判 `stash-version` | 先判 `stash-version`。Stash 将来若补上 `surge-version` 也不会认错 |
| `bd09mcToBd09` | 超出定义域的输入会算出 `lon=8983` 这类越界垃圾并返回 | 出口加值域判断, 越界返回 `null` |
| gzip 解压 | 打包 pako (占产物体积大头) | 手写 RFC 1951 解码器, 与 Node zlib 对拍 600 轮 |
| Worker 框架 | Hono | 原生 fetch handler, 零 npm 运行时依赖 |
| 自动化测试 | 解析与 Stash 输出格式 | 增加六平台端到端、优先级/透传、负坐标、gzip、扰动、路由与外链白名单 |

## 沿用的兼容性约定

以下刻意与上游保持一致, 目的是让从上游迁移过来的用户不丢数据、不用改习惯:

- 持久化存储键名 `wloc_settings` 及其字段结构
- 伪造端点路径 `/wloc-settings/save` 及 `action=save|query|clear`
- 出厂示例坐标 `113.94114, 22.544577` 与「哨兵值即透传」的语义
- WLOC 域名集合与 MITM 主机名列表

## 可复现性

上述哈希可以自行核对:

```bash
curl -sL https://codeload.github.com/<镜像>/tar.gz/refs/heads/main | tar xz
sha256sum */dist/wloc.js */dist/wloc-settings.js */LICENSE
```

本项目自身的独立性随时可查:

```bash
npm run check
```
