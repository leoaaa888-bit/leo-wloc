# 自部署

选点页面和链接解析 API 在同一个 Cloudflare Worker 里。**没有任何 npm 运行时依赖**,
不需要 KV、D1、R2 或环境变量。

Workers 和 Pages 跑的是同一份代码 (`worker/src/index.js` 的 `handleRequest`),
功能完全一致, 选一种即可。

## 准备

```bash
git clone https://github.com/leoaaa888-bit/leo-wloc.git
cd leo-wloc/worker
npx wrangler login
```

`wrangler` 用 `npx` 按需拉取, 不必全局安装, 项目本身也不把它列为依赖。

## Pages (推荐)

```bash
npx wrangler pages deploy -c wrangler.pages.jsonc
```

首次部署会问 production branch, 填 `main`。完成后得到 `https://<项目名>.pages.dev`。

> 必须带 `-c wrangler.pages.jsonc`。直接跑 `wrangler pages deploy dist` 会丢掉配置里的
> `compatibility_date`, Pages 和 Workers 就落在不同的运行时语义上了。

也可以用脚本快捷方式:

```bash
npm run pages:deploy
```

## Workers

```bash
npx wrangler deploy
```

得到 `https://leo-wloc.YOUR-SUBDOMAIN.workers.dev`。

免费账户每天 10 万次请求 —— 个人用绰绰有余, 选点页面一次访问也就几个请求。

## 本地调试

```bash
npm run dev          # Workers 模式, http://localhost:8787
npm run pages:dev    # Pages 模式, http://localhost:8787
```

本地能测页面和 `/api/parse`。**「储存到设备」在电脑上一定失败** —— 那条请求需要手机上
的代理模块拦截, 桌面浏览器里没有。

## 改成你自己的地址

如果你 fork 了本项目, 有三处必须改:

### 1. `worker/src/config.js`

```js
export const PROJECT = {
  owner: "你的GitHub账号",
  repo: "你的仓库名",
  branch: "main",
  pages: "https://你的项目.pages.dev",
  // …
};
```

这一处决定页面底部的源码链接、`/source` 跳转, 以及 `/api/health` 的输出。

> **AGPL-3.0 第 13 条要求你向服务使用者提供你那份修改后的源码。** 不改这里, 页面上
> 的「源码」链接指向的仍是本仓库, 你的修改没有被公开。

### 2. `modules/*` 里的五处 `script-path`

把 `leoaaa888-bit/leo-wloc` 换成你的 `账号/仓库`。同时改:

- `#!homepage=`
- `#!icon=`
- `#!author=`
- `#!desc=` 里的选点页面地址

### 3. `scripts/check.mjs` 顶部的常量

```js
const OWNER = "你的GitHub账号";
const REPO = "你的仓库名";
const PAGES_URL = "https://你的项目.pages.dev";
```

改完跑一遍自检, 它会告诉你还有哪里没改干净:

```bash
npm run check
```

## 自定义域名

### Pages

1. Cloudflare 控制台 → **Workers & Pages** → 选中你的 Pages 项目
2. **Custom domains** → **Set up a domain**
3. 填 `wloc.你的域名.com` → 确认

域名需要托管在同一个 Cloudflare 账户下。DNS 记录会自动创建, 证书几分钟内签发。

### Workers

1. 控制台 → 选中 Worker → **Settings → Domains & Routes**
2. **Add → Custom domain**

绑好之后记得把 `worker/src/config.js` 里的 `pages` 和模块 `#!desc=` 里的地址一起换掉。

## 更新

代理脚本是直接从 GitHub raw 读取的, **改完提交就生效**, 不用重新部署 Worker:

```bash
# 改了 dist/wloc.js 或 dist/wloc-settings.js
git add dist/ && git commit -m "..." && git push
```

代理工具会按自己的周期刷新脚本 (Stash 模块里写的是 86400 秒), 想立刻生效就在工具里
手动更新一次模块。

**改了 `worker/` 下的东西才需要重新部署:**

```bash
cd worker && npx wrangler pages deploy -c wrangler.pages.jsonc
```

## 部署前自检

```bash
npm run check          # 离线: URL、品牌、模块、共享代码块一致性
npm run check -- --net # 额外真去请求一遍所有对外 URL
npm test               # 97 个测试
```
