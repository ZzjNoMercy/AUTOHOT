import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceFilterItems } from "../app/features/feed/source-filters.ts";

test("来源筛选只显示站点配置的选项，并使用配置显示名", () => {
  const items = sourceFilterItems([
    { id: "ext-cls", name: "财联社", kind: "external", count: 328 },
    { id: "ithome-auto", name: "IT之家（汽车）", kind: "web_list", count: 277 },
    { id: "gasgoo-auto", name: "盖世汽车", kind: "web_list", count: 161 },
    { id: "xchuxing-official", name: "新出行", kind: "json_list", count: 99 },
  ], [
    { kind: "weibo", count: 453 },
    { kind: "mp_account", count: 7 },
    { kind: "x_search", count: 12 },
  ]);
  assert.deepEqual(items.map((item) => item.label), ["微博 453", "公众号 7", "财联社 328", "IT之家 277", "盖世汽车 161"]);
  assert.deepEqual(items.map((item) => item.value), ["kind:weibo", "kind:mp_account", "ext-cls", "ithome-auto", "gasgoo-auto"]);
});
