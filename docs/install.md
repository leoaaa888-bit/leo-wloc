# 安装

按你用的代理工具选一节。**先确认 [系统兼容性](compatibility.md)** —— iOS 27 beta 6
及以后本项目无法工作。

订阅地址统一前缀:

```
https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/
```

---

## Shadowrocket (小火箭)

```
https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.module
```

1. 打开 Shadowrocket → 底部 **配置** 标签
2. 右上角 **+** → 粘贴上面的地址 → **下载**
3. 回到 **首页**, 打开 **MITM** 开关
4. 进入 **配置 → 证书**, 生成 CA 证书并**安装**
5. 前往 **iOS 设置 → 通用 → VPN 与设备管理**, 安装描述文件
6. 前往 **iOS 设置 → 通用 → 关于本机 → 证书信任设置**, 为该证书打开**完全信任**
   (这一步最容易漏, 漏了会表现为「储存失败」)
7. 回到 Shadowrocket, 确认模块已启用, 连接开关打开

模块参数可在配置详情里改, 但**推荐直接用选点页面**, 不用手填经纬度。

---

## Surge

```
https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.sgmodule
```

1. Surge → **首页 → 模块 → 安装新模块**
2. 粘贴地址安装
3. 确认 **MITM** 已开启, CA 证书已安装并在「证书信任设置」中完全信任
4. 模块参数 (经度/纬度/精度/扰动半径/日志级别) 在模块详情页可改

> Egern 直接用这个 `.sgmodule`。

---

## Quantumult X

```
https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.conf
```

1. QX → **设置 → 重写 → 引用**
2. 添加上面的地址
3. **设置 → MITM**, 生成并信任证书, 确认 hostname 已包含模块里的域名

> **QX 不支持给 rewrite 脚本传参数**, 所以这里没有模块参数可调。坐标只能通过
> [选点页面](https://leo-wloc.pages.dev/) 写入。没写入过时脚本处于透传状态。

---

## Loon

```
https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.lpx
```

1. Loon → **配置 → 插件 → 添加插件**
2. 粘贴地址安装
3. 开启 **MITM**, 安装并完全信任证书
4. 插件详情里可改参数

---

## Stash

```
https://raw.githubusercontent.com/leoaaa888-bit/leo-wloc/main/modules/wloc.stoverride
```

1. Stash → **配置 → 覆写 → 添加**
2. 粘贴地址 (**直接订阅 `.stoverride`, 不需要 Script Hub 转换**)
3. 开启 **MITM**, 安装并完全信任证书

---

## 安装后验证

1. 确认代理已连接 (状态栏有 VPN 图标)
2. Safari 打开 <https://leo-wloc.pages.dev/>
3. 看「设备当前生效坐标」那张卡片:
   - 显示「无已保存坐标」→ **模块正常工作**, 只是还没设过坐标
   - 显示「查询失败 — 模块未拦截到请求」并弹出红色提示 → 模块没生效,
     照 [排查](troubleshooting.md) 逐条检查
4. 点地图选个位置 → **储存到设备** → 出现 ✓ 即成功
5. iOS 26+ **重启设备**, 然后打开地图 App 验证

## 把选点页面加到主屏幕

Safari 打开页面 → 分享 → **添加到主屏幕**。页面已经声明了
`apple-mobile-web-app-capable`, 从主屏幕启动会以全屏应用的样子打开。
