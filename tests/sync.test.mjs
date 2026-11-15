import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { plans, build } from "../tools/plans.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const between = (tag, id) => {
  const m = html.match(new RegExp(`<!--${tag}:${id}-->([\\s\\S]*?)<!--/${tag}:${id}-->`));
  assert.ok(m, `marcador ${tag}:${id} ausente`);
  return m[1].trim();
};

for (const p of plans) {
  const { svg, list } = build(p);
  test(`index.html em sincronia com o gerador: planta ${p.id}`, () => {
    assert.equal(between("plan", p.id), svg.trim());
  });
  test(`index.html em sincronia com o gerador: cômodos ${p.id}`, () => {
    assert.equal(between("rooms", p.id), list.trim());
  });
}

test("cada marcador de abertura aparece uma única vez", () => {
  for (const p of plans) for (const t of ["plan", "rooms"]) {
    assert.equal(html.split(`<!--${t}:${p.id}-->`).length - 1, 1, `${t}:${p.id}`);
  }
});
