# 项目结构

```
leo-wloc/
├── dist/                         代理脚本 —— 直接被代理工具下载执行
│   ├── wloc.js                   改写 WLOC 响应坐标 (主脚本)
│   └── wloc-settings.js          接收并存储坐标
│
├── modules/                      五个平台的订阅文件
│   ├── wloc.module               Shadowrocket
│   ├── wloc.sgmodule             Surge / Egern
│   ├── wloc.conf                 Quantumult X
│   ├── wloc.lpx                  Loon
│   └── wloc.stoverride           Stash
│
├── worker/                       选点页面 + 链接解析服务
│   ├── src/
│   │   ├── config.js             品牌与地址的唯一来源
│   │   ├── index.js              路由
│   │   ├── page.js               选点页面 (整页模板)
│   │   ├── geo.js                坐标系换算 (服务端)
│   │   ├── geo-browser.js        同上, 注入页面的浏览器版
│   │   └── parse.js              地图链接解析
│   ├── test/                     worker 测试
│   ├── functions/[[route]].js    Pages 的 catch-all 入口
│   ├── dist/_routes.json         Pages 路由声明
│   ├── wrangler.jsonc            Pages 部署配置 (必须是默认文件名)
│   ├── wrangler.workers.jsonc    Workers 部署配置 (用 -c 指定)
│   └── package.json              无运行时依赖
│
├── test/                         代理脚本测试
│   ├── helpers/wloc-fixture.mjs  protobuf 夹具 + 平台模拟器
│   ├── wloc.test.mjs
│   ├── wloc-settings.test.mjs
│   └── inflate.test.mjs
│
├── scripts/
│   ├── check.mjs                 独立性与一致性自检
│   └── build-icon.mjs            生成 assets/icon.png
│
├── docs/                         文档 (你正在看的这些)
├── assets/icon.png               项目图标 (本地生成)
├── LICENSE                       AGPL-3.0 全文
├── NOTICE.md                     来源、署名、第三方组件、隐私
├── README.md
└── package.json                  无依赖; 只有 test / check / icon 三个脚本
```

## 运行时真正需要哪些文件

只有这三类:

| 文件 | 谁去取它 | 什么时候 |
| --- | --- | --- |
| `modules/*` | 代理工具 | 订阅 / 刷新模块时 |
| `dist/*.js` | 代理工具 | 按模块声明的周期刷新 |
| `assets/icon.png` | 代理工具 | 显示模块图标时 |
| `worker/src/*` | Cloudflare | 部署时打包, 之后由 Worker 运行 |

其余全是文档、测试和构建辅助, **不参与运行**。

## dist/ —— 为什么没有构建步骤

`dist/wloc.js` 和 `dist/wloc-settings.js` **就是源码本身**, 不是编译产物。代理工具从
GitHub raw 下载到的字节, 和仓库里看到的完全一样。

这么做的理由:

1. **改起来直接** — 改文件、提交, 模块下次刷新就生效, 不用跑构建、不用维护
   rollup 配置
2. **可审计** — 你 (或任何人) 能读懂设备上实际跑的是什么
3. **AGPL 第 13 条天然满足** — 「对应源码」就是分发出去的那份东西

代价是两个文件里有一段约 140 行的**共享运行时**是重复的 (平台探测、存储、日志、
`$done` 约定)。`scripts/check.mjs` 会校验这两段**逐字节一致**, 防止悄悄漂开。

## worker/src/ 各文件

### `config.js`

品牌名、作者、GitHub 账号/仓库/分支、Pages 域名、写入端点。

**换品牌或迁仓库只改这一个文件。** 其余代码一律从这里读。

### `index.js`

四条路由:

| 路径 | 作用 |
| --- | --- |
| `/` | 选点页面 |
| `/api/parse` | 地图链接解析 (给页面和快捷指令用) |
| `/api/health` | 健康检查 |
| `/source` | 跳转到源码仓库 (AGPL 第 13 条) |

没有用 Hono 之类的框架 —— 四条路由用原生 fetch handler 就够, 换来 worker 端**零 npm
运行时依赖**, 部署不需要先 `npm install`。

### `page.js`

整个选点页面是一个模板串。页面内部的 JS 一律用**字符串拼接**而不是模板串 —— 外层
已经是模板串了, 内层再用反引号要处处转义。

### `geo.js` / `geo-browser.js` —— 为什么有两份

坐标换算在两个地方都要用: 服务端 (`/api/parse` 换算解析结果) 和浏览器 (点击地图时
在 GCJ-02 底图和 WGS84 之间来回换)。

两处跑在不同的运行时, 服务端函数传不到页面里。而且:

- `wrangler deploy --minify` 会重命名标识符, `fn.toString()` 出来的代码引用的是压缩后
  的名字, 注入页面必然对不上
- Cloudflare Workers 禁用 `eval` / `new Function`, 没法反过来让服务端复用字符串

所以 `geo-browser.js` 是一份**人工镜像的字符串常量**。代价是要保持同步 ——
`worker/test/geo.test.mjs` 会在 400 多个采样点上逐点比对两份实现, 任何一边改了另一边
没跟上, 测试立刻变红。

### `parse.js`

从地图链接里抠坐标。规则表 `RULES` 按**可靠性**排序:

1. 苹果 `coordinate=` / `ll=` / `sll=`
2. Google 针脚 `!3d!4d` (必须早于视口 `@`)
3. 高德 `?p=` / `?q=`
4. 高德 URI `lnglat=` / `position=` (注意这两个是「经度,纬度」序)
5. 百度网页版路径里的 BD09MC 米制 `@`
6. Google 视口 `@` (退而求其次)
7. 裸坐标兜底 (扫描页面正文时必须关掉)

每条规则旁边都写了它为什么必须在当前位置。**顺序不是随便排的。**

## test/ —— 测什么

| 文件 | 覆盖 |
| --- | --- |
| `test/wloc.test.mjs` | 六个平台各自的改写与 `$done` 约定、优先级、透传、负坐标、gzip、扰动、失败放行 |
| `test/wloc-settings.test.mjs` | save / query / clear、参数校验、两脚本间的数据交接 |
| `test/inflate.test.mjs` | 自写 DEFLATE 解码器与 Node zlib 对拍 600 轮 |
| `worker/test/geo.test.mjs` | 换算精度、港澳台分派、深港边界、两份实现一致性 |
| `worker/test/parse.test.mjs` | 各家链接格式、以及各种「不该认错」的反例 |
| `worker/test/http.test.mjs` | 路由、CORS、页面外链白名单、AGPL 源码入口 |

**全程离线**, 不发任何网络请求。夹具里的地图链接是被解析的输入数据, 不会被访问。

夹具 `test/helpers/wloc-fixture.mjs` 里的 protobuf 编解码是**另写一遍**的 (用 BigInt
走了与被测代码不同的路径) —— 拿被测实现去生成被测输入, 两边一起错的时候测试反而
是绿的。

## scripts/check.mjs

回答一个问题: **这个仓库在运行时还依赖别人的东西吗?**

它区分两件事:

- **运行时引用** — 任何指向上游或镜像仓库/部署的 URL。**必须为 0。**
- **署名文字** — 注释和 NOTICE 里提到上游作者名。AGPL-3.0 要求保留, 只限制出现位置。

混为一谈的话, 要么删掉法律上必须保留的署名, 要么放过真正的运行时依赖。

还会检查: 模块 `script-path` 是否都指向本仓库、共享运行时块是否一致、仓库内自引用的
文件是否真实存在、对外主机是否在白名单内、许可证声明是否齐全。

`--net` 会额外真去请求一遍所有对外 URL。
