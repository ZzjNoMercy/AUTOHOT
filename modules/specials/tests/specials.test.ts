// Candidate grouping, membership matching and the public read: a conference collects reports that
// name it; an editor detaching one keeps it out of later automatic matches.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { closeDb, sql } from "@aihot/backend/db";
import Fastify from "fastify";
import { specialsServer } from "../server.ts";
import { pointModels, stub } from "../../../tests/setup.ts";
import { composeSpecialDigest } from "../digest.ts";
import { createSpecial, getAdminSpecial, listAdminSpecials, updateSpecial } from "../admin.ts";
import { scanCandidates } from "../candidates.ts";
import { loadSpecial, syncMembership, detach } from "../membership.ts";
import { loadSpecialBySlug, loadSpecials } from "../public.ts";

const T = Date.now().toString(36);
after(() => closeDb());

async function source(suffix: string) {
  const id = `special-test-${T}-${suffix}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, config, first_party, next_fetch_at)
    VALUES (${id}, ${suffix}, 'rss', 'T2', 'editorial', '{}', true, '2100-01-01')`;
  return id;
}

async function report(sourceId: string, title: string, at = "2026-10-20T10:00:00+08:00") {
  const id = `special-test-${T}-${randomUUID()}`;
  const date = new Date(at);
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, timeline_at, discovered_at, published_at)
    VALUES (${id}, ${sourceId}, ${id}, ${`https://example.org/${id}`}, ${title}, ${date}, ${date}, ${date})`;
  await sql`INSERT INTO publications (article_id, source_id, title, summary, url, channel, first_party, timeline_at, discovered_at, published_at, sort_at,
      selected, eligible, visible_after, tags, body_mode, score)
    VALUES (${id}, ${sourceId}, ${title}, ${title}, ${`https://example.org/${id}`}, 'news', true, ${date}, ${date}, ${date}, ${date},
      false, true, ${date}, '{}', 'summary', 50)`;
  return id;
}

test("a conference candidate becomes a special and collects reports by name", async () => {
  const first = await source("conference-a");
  const second = await source("conference-b");
  const third = await source("conference-c");
  for (const [i, s] of [first, second, third].entries()) {
    await report(s, `2026 奇瑞全球创新大会发布新技术 ${i + 1}`);
  }
  const candidate = (await scanCandidates(14)).find((c) => c.name === "奇瑞全球创新大会");
  assert.ok(candidate, "three independent sources make a candidate");
  assert.equal(candidate.sourceCount, 3);

  const id = await createSpecial({
    title: "奇瑞全球创新大会",
    aliases: ["奇瑞创新大会"],
    startsAt: "2026-10-19",
    endsAt: "2026-10-22",
  });
  await updateSpecial(id, { status: "published" });
  const special = (await loadSpecial(id))!;
  await syncMembership(special);
  const publicSpecial = (await loadSpecialBySlug(special.slug))!;
  assert.equal(publicSpecial.reportCount, 3);
  assert.equal(publicSpecial.sourceCount, 3);
  assert.equal(publicSpecial.timeline.length, 3);

  const fourth = await report(await source("conference-d"), "奇瑞创新大会：新车与黑科技");
  await syncMembership((await loadSpecial(id))!);
  assert.equal((await loadSpecialBySlug(special.slug))!.reportCount, 4, "a later report joins automatically");

  await detach(id, fourth);
  await syncMembership((await loadSpecial(id))!);
  assert.equal((await loadSpecialBySlug(special.slug))!.reportCount, 3, "an excluded report is not re-added");

  assert.ok((await loadSpecials()).specials.some((s) => s.slug === special.slug));
  const admin = await listAdminSpecials();
  assert.ok(admin.specials.some((s) => s.id === id && s.reportCount === 3));
  const detail = await getAdminSpecial(id);
  assert.equal(detail?.reports.length, 3);
  assert.ok(detail?.reports.every((r) => r.storyPublicId === null));
});

test("the public specials routes answer from the same read layer", async () => {
  const app = Fastify();
  specialsServer.http!(app);
  await app.ready();
  try {
    const list = await app.inject({ method: "GET", url: "/api/specials" });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().specials.length >= 1);
    const special = list.json().specials[0];
    const detail = await app.inject({ method: "GET", url: `/api/specials/${special.slug}` });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().special.slug, special.slug);
    const missing = await app.inject({ method: "GET", url: "/api/specials/not-here" });
    assert.equal(missing.statusCode, 404);
    const admin = await app.inject({ method: "GET", url: "/api/admin/specials" });
    assert.equal(admin.statusCode, 401, "the editor API needs a session");
  } finally {
    await app.close();
  }
});

test("a published special writes its overview from the member events", async () => {
  const provider = await stub(() => ({ id: "local", choices: [{ message: { content: JSON.stringify({ digest: "奇瑞在创新大会上发布了新的模型、芯片与电池技术，并把 AI 化作为下一阶段的路线。" }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  pointModels(provider.url);
  try {
    const id = await createSpecial({ title: "奇瑞创新大会综述测试", aliases: ["奇瑞创新大会"], startsAt: "2026-10-19", endsAt: "2026-10-22" });
    await report(await source("conference-digest"), "奇瑞创新大会发布新模型与芯片");
    await updateSpecial(id, { status: "published" });
    await composeSpecialDigest(id);
    const special = (await loadSpecial(id))!;
    assert.match(special.digest ?? "", /奇瑞在创新大会上/);
  } finally {
    await provider.close();
  }
});

test("a report that names the conference only in its body still adds an independent source", async () => {
  const a = await source("body-a");
  const b = await source("body-b");
  const c = await source("body-c");
  await report(a, "世界智能网联汽车大会开幕");
  await report(b, "世界智能网联汽车大会：L4 路线之争");
  const third = await report(c, "某车企发布 L4 方案");
  await sql`UPDATE articles SET body_text = '在2026世界智能网联汽车大会上，该车企发布了 L4 方案。' WHERE id = ${third}`;
  const candidate = (await scanCandidates(14)).find((x) => x.name === "世界智能网联汽车大会");
  assert.ok(candidate, "the body mention is part of the same candidate");
  assert.equal(candidate.sourceCount, 3);
  assert.ok(candidate.samples.includes("某车企发布 L4 方案"));
});
