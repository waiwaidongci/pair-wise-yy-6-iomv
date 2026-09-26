# 墨锭试磨室

运行：

```bash
npm start
```

访问`http://localhost:3037`。墨锭数据保存在`data/ink-stick-testing.json`，耐久卡保存在`data/durability-cards.json`。

测试：

```bash
npm test
```

## 潮箱耐久卡

试磨余墨存进潮箱做耐久卡，职责分三层：`src/sampling-rules.js`（取样规则）、`src/durability-archive.js`（档案保存）、`src/page.js`（页面操作），`server.js` 只做路由。

- **建档**：每份墨样记编号、余墨重量、取样人。不足 3 克或发霉的墨样留待取样、不占卡；补足重量后可再次建档。同一编号重复建档返回 409，写操作串行化并原子落盘，记录不留半截。
- **读数**：满 7 天、满 14 天各记一次色差（ΔE）与起皮，两次须由不同人记录；色差 ≤ 2.0 且未起皮为正常，两次都正常才算耐久。
- **失效**：原试磨评分或沉淀更正后（`POST /api/items/:id/correction`），关联卡立即失效并移出统计，旧读数仍能查（`GET /api/durability/cards/:id`）。
- **列表**：`GET /api/durability` 返回待读数、已完成、已失效的卡和留待取样的墨样；统计只覆盖有效卡。

| 接口 | 说明 |
| --- | --- |
| `POST /api/durability/cards` | 墨样建档（201 占卡 / 200 留待取样 / 409 重复） |
| `POST /api/durability/cards/:id/readings` | 录入满 7 天或满 14 天读数 |
| `GET /api/durability` | 卡片列表、留样清单与统计 |
| `GET /api/durability/cards/:id` | 单卡详情，已失效卡的旧读数仍可查 |
| `POST /api/items/:id/correction` | 更正试磨评分或沉淀，关联卡即时失效 |
