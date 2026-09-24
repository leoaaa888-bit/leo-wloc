<p align="center">
  <img src="assets/icon.png" width="120" alt="Leo WLOC">
</p>

<h1 align="center">Leo WLOC</h1>

<p align="center">
  修改 Apple 网络定位 (WLOC) 返回的坐标 —— 独立部署、零运行时依赖。<br>
  <a href="https://leo-wloc.pages.dev/">在线选点页面</a> ·
  <a href="docs/install.md">安装</a> ·
  <a href="docs/deploy.md">自部署</a> ·
  <a href="docs/shortcut.md">快捷指令</a> ·
  <a href="docs/troubleshooting.md">排查</a>
</p>

---

> [!WARNING]
> **先读这条, 它决定这个项目对你有没有用。**
>
> 从 **iOS 27 beta 6** 起, 系统禁止对 `gs-loc.apple.com` / `gs-loc-cn.apple.com`
> 做 MITM 拦截, 本项目在受影响的系统版本上**无法工作**。
>
> 限制发生在 **TLS 证书校验层**: `locationd` 仍然正常走系统代理, 请求也确实到得了
> 中间人, 但它拒绝任何非 Apple CA 签发的证书 —— 即使该 CA 已在「证书信任设置」里
> 打开完全信任。因为校验发生在设备内部的 `locationd` 进程中, **换软路由、网关侧
> 透明代理或其它 MITM 工具同样无效** —— 那些方案改变的只是流量路径, 而问题出在
> 路径终点。
>
> 详见 [系统兼容性](docs/compatibility.md)。该结论来自上游项目的实测报告, 本项目
> **未独立复验**。

---

## 这是什么

iOS 的定位由三部分拼成: GPS 硬件、WiFi/基站网络定位、以及各种缓存。其中网络定位
走的是 Apple 的 WLOC 服务 —— 设备把周围看到的 WiFi MAC 和基站信息发给
`gs-loc.apple.com/clls/wloc`, 服务器回一份「这些设备分别在哪里」的清单。

本项目在代理工具里拦下那份响应, 把清单里的坐标换成你指定的位置。

```
你在选点页面点一下地图
  → 页面请求 gs-loc.apple.com/wloc-settings/save?lon=..&lat=..
  → 代理模块拦截 (这条请求从不离开设备)
  → wloc-settings.js 写入 $persistentStore
  ↓
系统下次发起网络定位
  → 代理模块拦截 /clls/wloc 的响应
  → wloc.js 解析 protobuf, 替换坐标, 重新封帧
  → 系统拿到改过的坐标
```

**只影响网络定位, 不影响 GPS 硬件定位。** 室内、WiFi 环境下效果最好; 户外 GPS
信号强时系统可能直接忽略网络定位结果。

## 订阅地址

| 工具 | 订阅链接 |
| --- | --- |
| **Shadowrocket** | `https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.module` |
| **Surge** | `https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.sgmodule` |
| **Quantumult X** | `https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.conf` |
| **Loon** | `https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.lpx` |
| **Stash** | `https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.stoverride` |

> Egern 直接用 Surge 模块。Stash 请直接订阅 `.stoverride`, 不需要 Script Hub 转换。

选点页面: **<https://leo-wloc.pages.dev/>**

安装步骤见 [docs/install.md](docs/install.md)。

## 用法

1. 订阅上面对应你工具的模块, 开启 MITM 并信任 CA 证书
2. Safari 打开 <https://leo-wloc.pages.dev/> (建议添加到主屏幕)
3. 点地图 / 搜地名 / 粘贴地图链接选好位置
4. 点「储存到设备」, 看到 ✓ 即写入成功
5. 下次系统发起网络定位时生效

> **iOS 26 及以上需要重启设备。** Apple 从 iOS 26 起大幅强化了 `locationd` 的定位
> 缓存, 系统会把之前拿到的真实定位在内存里留很久并反复复用。这意味着即使脚本日志
> 显示「已改写」, 系统仍可能在用缓存里的旧坐标。飞行模式、关闭定位服务都清不掉它,
> **只有重启可以**。iOS 15~18 通常不需要重启。

## 选点页面能做什么

- 点击地图 / 拖动针脚选点, 实时显示 WGS84 经纬度
- 五种底图: 卫星、街道、高德、标准、暗色 (切到高德会自动做 GCJ-02 双向换算)
- 搜索地名 (Nominatim)
- 粘贴 **Apple Maps / Google Maps / 高德 / 百度** 分享链接或纯坐标文本, 自动展开
  短链并按「来源 × 地区」换算坐标系
- 收藏常用位置 (存浏览器本地), 与当前生效坐标对照显示
- 查看 / 清除设备上已保存的坐标
- 扰动半径: 每次定位在目标点周围随机偏移指定米数, 避免结果完全一致

## 配置与优先级

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `longitude` / `latitude` | 目标坐标 | 出厂示例值 (等同透传) |
| `accuracy` | 精度 (米) | `25` |
| `randomRadius` | 扰动半径 (米), `0` 关闭 | `0` |
| `logLevel` | `off` / `error` / `warn` / `info` / `debug` / `all` | `info` |

**优先级 (高 → 低):**

```
1. 选点页面 / 快捷指令写入的持久化存储  (wloc_settings)
2. 模块参数 (argument)
3. 内置默认值
```

**什么时候进入透传 (不改定位):**

- 没有持久化坐标, 且模块参数保持出厂示例值 `113.94114, 22.544577` → 透传
- 在选点页面点「清除数据」→ 透传

出厂示例值起的是「哨兵」作用: 如果你从没动过模块参数又清掉了数据, 你的意图显然是
恢复真实定位, 而不是被送到深圳湾去。**但如果你在模块参数里填了自己的坐标, 清除数据
不会退回透传** —— 那时脚本会按你填的参数走。

> Quantumult X 的 `rewrite_local` 脚本不支持参数, QX 用户只能通过选点页面设置坐标。
> 这是 QX 的机制限制。

## 恢复真实定位

两种方式:

1. **关掉或删除模块** (最干净) — 脚本不再拦截, 系统自动恢复
2. **选点页面点「清除数据」** — 脚本进入透传, 原样放行 WLOC 响应

两种方式在 iOS 26+ 都需要**重启设备**才能清掉定位缓存。

也可以在代理工具的脚本编辑器里手动清:

```js
$persistentStore.write(null, "wloc_settings")   // Surge / Loon / Shadowrocket
$prefs.removeValueForKey("wloc_settings")       // Quantumult X
```

## 自部署

选点页面和链接解析服务都在一个 Cloudflare Worker 里, **没有任何 npm 运行时依赖**,
不需要 KV、数据库或环境变量。

```bash
git clone https://github.com/leoaaa888-bit/leo-wloc.git
cd leo-wloc/worker
npx wrangler login
npx wrangler pages deploy                      # Pages (推荐)
npx wrangler deploy -c wrangler.workers.jsonc  # 或 Workers
```

> `wrangler pages deploy` 不支持 `-c`, 只读默认文件名的配置 —— 所以
> `worker/wrangler.jsonc` 是 Pages 的, Workers 那份叫 `wrangler.workers.jsonc`。

完整步骤 (含自定义域名、改成你自己的仓库地址) 见 [docs/deploy.md](docs/deploy.md)。

## 开发

```bash
npm test           # 97 个测试, 全程离线
npm run check      # 独立性自检: 确认没有指向上游/镜像的运行时引用
npm run check -- --net   # 额外实际请求一遍所有对外 URL
npm run icon       # 重新生成 assets/icon.png
```

项目结构与各文件职责见 [docs/structure.md](docs/structure.md)。

代理脚本 `dist/wloc.js` 和 `dist/wloc-settings.js` **就是源码本身** —— 没有构建步骤,
代理工具下载到的和仓库里的是同一份字节。改行为直接改那两个文件。

## 许可证与来源

**AGPL-3.0-or-later** —— 见 [LICENSE](LICENSE)。

本项目的实现思路来自一个已从 GitHub 下线的 AGPL-3.0 上游项目, 代码为独立重写。
完整的来源说明、逐条的「重写了什么 / 沿用了什么」、第三方组件清单和隐私说明见
**[NOTICE.md](NOTICE.md)**。

> 如果你 fork 了本项目并部署成联网服务, AGPL-3.0 第 13 条要求你向服务的使用者提供
> 你那份修改后的源码。请把 `worker/src/config.js` 里的仓库地址改成你自己的 —— 否则
> 页面上的「源码」链接指向的仍是本仓库。

## 免责

本项目用于定位相关功能的开发与测试。使用者需自行确认其用途符合当地法律以及所涉
服务的条款。修改定位可能违反某些应用的服务协议。
