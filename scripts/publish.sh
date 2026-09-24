#!/usr/bin/env bash
# 一键发布: 推送到 GitHub + 部署 Cloudflare Pages + 联网复验。
#
#   bash scripts/publish.sh
#
# 前提: GitHub 上已经存在一个同名的空 public 仓库 (GitHub 不支持 push 时自动创建)。
# 脚本会先检查这一点, 缺了就停下来告诉你去哪建。
#
# 全程幂等: 中途失败修好后重跑即可, 已完成的步骤会跳过。

set -u

OWNER="leoaaa888-bit"
REPO="leo-wloc"
BRANCH="main"
PAGES_PROJECT="leo-wloc"

REPO_URL="https://github.com/${OWNER}/${REPO}"
RAW_PROBE="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/dist/wloc.js"

# 本机的 Clash 代理实测返回 502, 让它参与只会让 git / wrangler / npm 全线超时。
# 这几个变量只在本脚本的进程里清空, 不影响你的终端。
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export NO_PROXY='*'
export WRANGLER_SEND_METRICS=false

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✖ %s\033[0m\n\n' "$*" >&2; exit 1; }

# curl 在这台 Windows 上用 schannel, 证书吊销列表拉不到时会整个握手失败,
# --ssl-no-revoke 只关掉吊销检查, 证书链本身照常校验。
CURL=(curl -sS --noproxy '*' --ssl-no-revoke --max-time 25)
code_of() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

# ---------------------------------------------------------------------------
bold "[1/6] 本地状态"
# ---------------------------------------------------------------------------
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "这里不是 git 仓库: $ROOT"
[ -n "$(git status --porcelain)" ] && {
  git status --short
  die "工作区有未提交的改动。先 git add -A && git commit, 再跑本脚本。"
}
ok "工作区干净, HEAD = $(git rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
bold "[2/6] 测试与独立性自检"
# ---------------------------------------------------------------------------
node --test test/*.test.mjs worker/test/*.test.mjs >/tmp/leo-wloc-test.log 2>&1 \
  || { tail -30 /tmp/leo-wloc-test.log; die "测试未通过, 已中止发布。"; }
ok "$(grep -E '^ℹ pass' /tmp/leo-wloc-test.log | head -1 | tr -d '\r') / $(grep -E '^ℹ tests' /tmp/leo-wloc-test.log | head -1 | tr -d '\r')"

node scripts/check.mjs >/tmp/leo-wloc-check.log 2>&1 \
  || { tail -25 /tmp/leo-wloc-check.log; die "独立性自检未通过, 已中止发布。"; }
ok "独立性自检通过 (运行时零上游引用)"

# ---------------------------------------------------------------------------
bold "[3/6] 确认 GitHub 仓库存在"
# ---------------------------------------------------------------------------
api_code=$(code_of "https://api.github.com/repos/${OWNER}/${REPO}")
if [ "$api_code" = "404" ]; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    warn "仓库不存在, 用 gh 创建中…"
    gh repo create "${OWNER}/${REPO}" --public --disable-wiki \
      --description "Leo WLOC · 独立部署的 Apple 网络定位坐标修改工具" \
      || die "gh repo create 失败"
    ok "已创建 ${REPO_URL}"
  else
    die "GitHub 上还没有 ${OWNER}/${REPO}。
  请先打开 https://github.com/new 手动创建:
    · Repository name : ${REPO}
    · 可见性          : Public   (private 仓库的 raw 链接拉不到, 模块会下载失败)
    · 不要勾选        : Add a README / .gitignore / license
  建好之后重跑本脚本。"
  fi
elif [ "$api_code" = "200" ]; then
  ok "仓库已存在: ${REPO_URL}"
else
  die "查询 GitHub API 返回 ${api_code} —— 网络不通? 先确认能访问 github.com。"
fi

# ---------------------------------------------------------------------------
bold "[4/6] 推送"
# ---------------------------------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  cur=$(git remote get-url origin)
  [ "$cur" = "${REPO_URL}.git" ] || git remote set-url origin "${REPO_URL}.git"
else
  git remote add origin "${REPO_URL}.git"
fi
ok "origin = $(git remote get-url origin)"

echo "  推送中 (首次可能弹出 GitHub 登录窗口)…"
git push -u origin "$BRANCH" || die "git push 失败。看上面的报错 —— 常见原因是仓库非空, 或凭据未通过。"
ok "已推送 $BRANCH"

echo "  等待 raw.githubusercontent 生效…"
for i in $(seq 1 30); do
  [ "$(code_of "$RAW_PROBE")" = "200" ] && { ok "raw 已可访问 (${i}s)"; break; }
  sleep 2
  [ "$i" = 30 ] && warn "raw 还没生效 —— CDN 有时要等一两分钟, 不影响后续步骤。"
done

# ---------------------------------------------------------------------------
bold "[5/6] 部署 Cloudflare Pages"
# ---------------------------------------------------------------------------
cd "$ROOT/worker" || die "找不到 worker 目录"

if npx --yes wrangler@4 whoami >/tmp/leo-wloc-who.log 2>&1 && ! grep -qi "not authenticated\|You are not" /tmp/leo-wloc-who.log; then
  ok "Cloudflare 已登录: $(grep -oE '[^ ]+@[^ ]+' /tmp/leo-wloc-who.log | head -1)"
else
  warn "未登录 Cloudflare, 即将打开浏览器授权…"
  npx --yes wrangler@4 login || die "wrangler login 失败"
fi

npx --yes wrangler@4 pages deploy -c wrangler.pages.jsonc --project-name "$PAGES_PROJECT" --branch "$BRANCH" \
  || die "Pages 部署失败。若提示项目不存在, 去 Cloudflare 控制台 Workers & Pages 里先建一个名为 ${PAGES_PROJECT} 的 Pages 项目, 或改 PAGES_PROJECT 变量。"
ok "Pages 已部署"

cd "$ROOT" || exit 1

# ---------------------------------------------------------------------------
bold "[6/6] 联网复验"
# ---------------------------------------------------------------------------
node scripts/check.mjs --net 2>&1 | tail -25

bold "完成 — 手机上用这条订阅"
echo
echo "  Shadowrocket:"
echo "    https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/modules/wloc.module"
echo
echo "  选点页面:"
echo "    https://${PAGES_PROJECT}.pages.dev/"
echo
echo "  iOS 26 提醒: 储存坐标后必须重启手机才会生效 (飞行模式/关定位都清不掉缓存)。"
echo "  详细步骤见 docs/install.md 与 docs/compatibility.md"
echo
