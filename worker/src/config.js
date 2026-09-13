// 项目身份与外部地址的唯一来源。
//
// 改品牌 / 换域名 / 迁仓库时只动这个文件, 其它地方一律从这里读。
// scripts/check.mjs 会校验仓库里不存在硬编码的旧地址。

export const PROJECT = {
  name: "Leo WLOC",
  shortName: "LeoWLOC",
  author: "Leo",
  version: "1.0.0",

  // GitHub
  owner: "leoaaa888-bit",
  repo: "leo-wloc",
  branch: "main",

  // 部署地址
  pages: "https://leo-wloc.pages.dev",
};

export const REPO_URL = `https://github.com/${PROJECT.owner}/${PROJECT.repo}`;
export const RAW_BASE = `https://raw.githubusercontent.com/${PROJECT.owner}/${PROJECT.repo}/${PROJECT.branch}`;
export const ISSUES_URL = `${REPO_URL}/issues`;

/**
 * 选点页面写坐标用的伪造端点。
 *
 * 用 Apple 自己的域名而不是本站地址: 模块已经为 gs-loc 开了 MITM, 这条请求根本
 * 不会离开设备 —— 它被 wloc-settings.js 就地截下并伪造响应。好处是页面不需要
 * 知道、也不需要信任任何自建服务器, 坐标不会经过网络。
 */
export const SAVE_API = "https://gs-loc.apple.com/wloc-settings/save";

/** 页面初始视角: 深圳湾。没有特殊含义, 只是个有地标的起点。 */
export const DEFAULT_CENTER = { lat: 22.544577, lon: 113.94114, zoom: 13 };

/**
 * AGPL-3.0 第 13 条: 通过网络提供服务的修改版, 必须让使用者能取得对应源码。
 * 页面底部的「源码」链接指向这里。
 */
export const SOURCE_OFFER_URL = REPO_URL;
