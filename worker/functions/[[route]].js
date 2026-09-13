// Cloudflare Pages 的 catch-all Function。
// Pages 和 Workers 共用 src/index.js 里的同一个 handleRequest, 两种部署方式的
// 行为因此必然一致 —— 不存在「Pages 上好使 Workers 上不好使」这种情况。
import { handleRequest } from "../src/index.js";

export const onRequest = (context) => handleRequest(context.request);
