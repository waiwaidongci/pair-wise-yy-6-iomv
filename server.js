// HTTP 接入层：路由、解析 JSON、把领域错误翻译成状态码。
// 业务规则在 rules.js，原子保存/串行临界区在 store.js，页面在 page.js。
import http from "node:http";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./store.js";
import { page } from "./page.js";
import {
  DomainError,
  createItem,
  addTest,
  updateItemStatus,
  appendLog,
  createCard,
  addReading,
  correctTest,
  listCards,
  cardStats,
  decorateCard
} from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "ink-stick-testing.json");
const port = Number(process.env.PORT || 3037);
const store = new JsonStore(dbPath);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError(400, "invalid_json", "请求体不是合法 JSON");
  }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function summarize(item) {
  const logCount = (item.logs || []).length;
  return { ...item, logCount };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page());
    }

    // ---- 墨锭档案 ----
    if (req.method === "GET" && url.pathname === "/api/items") {
      const db = await store.read();
      return send(res, 200, db.items.map(summarize));
    }
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await readBody(req);
      // 重复建档在 mutate 临界区内判定并整体回滚：并发请求也只会成功一份。
      const item = await store.mutate(db => createItem(db, input));
      return send(res, 201, item);
    }
    let m;
    if ((m = url.pathname.match(/^\/api\/items\/([^/]+)$/)) && req.method === "PATCH") {
      const code = decodeURIComponent(m[1]);
      const input = await readBody(req);
      const item = await store.mutate(db => updateItemStatus(db, code, input.status));
      return send(res, 200, item);
    }
    if ((m = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/)) && req.method === "POST") {
      const code = decodeURIComponent(m[1]);
      const input = await readBody(req);
      const item = await store.mutate(db => appendLog(db, code, input));
      return send(res, 201, item);
    }
    if ((m = url.pathname.match(/^\/api\/items\/([^/]+)\/tests$/)) && req.method === "POST") {
      const code = decodeURIComponent(m[1]);
      const input = await readBody(req);
      const result = await store.mutate(db => addTest(db, code, input));
      return send(res, 201, result.item);
    }
    if ((m = url.pathname.match(/^\/api\/items\/([^/]+)\/tests\/([^/]+)\/correction$/)) && req.method === "POST") {
      const code = decodeURIComponent(m[1]);
      const testId = decodeURIComponent(m[2]);
      const patch = await readBody(req);
      // 更正与失效联动在同一临界区：要么评分和卡状态一起落盘，要么都不动。
      const result = await store.mutate(db => correctTest(db, code, testId, patch));
      return send(res, 200, result);
    }

    // ---- 潮箱耐久卡 ----
    if (req.method === "GET" && url.pathname === "/api/cards") {
      const db = await store.read();
      const status = url.searchParams.get("status") || undefined;
      return send(res, 200, listCards(db, { status }));
    }
    if (req.method === "GET" && url.pathname === "/api/cards/stats") {
      const db = await store.read();
      return send(res, 200, cardStats(db));
    }
    if (req.method === "POST" && url.pathname === "/api/cards") {
      const input = await readBody(req);
      const card = await store.mutate(db => createCard(db, input));
      return send(res, 201, card);
    }
    if ((m = url.pathname.match(/^\/api\/cards\/([^/]+)\/readings$/)) && req.method === "POST") {
      const cardId = decodeURIComponent(m[1]);
      const input = await readBody(req);
      const card = await store.mutate(db => addReading(db, cardId, input));
      return send(res, 201, card);
    }
    if ((m = url.pathname.match(/^\/api\/cards\/([^/]+)$/)) && req.method === "GET") {
      const cardId = decodeURIComponent(m[1]);
      const db = await store.read();
      const card = (db.cards || []).find(c => c.id === cardId || c.code === cardId);
      if (!card) throw new DomainError(404, "card_not_found", "耐久卡不存在");
      return send(res, 200, decorateCard(card, db.items));
    }
    if (req.method === "GET" && url.pathname === "/api/stats") {
      const db = await store.read();
      const stages = ["待试磨", "已试磨", "重点观察"];
      const stats = Object.fromEntries(stages.map(s => [s, 0]));
      for (const item of db.items) if (stats[item.status] !== undefined) stats[item.status] += 1;
      return send(res, 200, stats);
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof DomainError) {
      return send(res, error.status, { error: error.code, message: error.message });
    }
    send(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, () => console.log("墨锭试磨室 listening on http://localhost:" + port));
