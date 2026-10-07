const test = require("node:test");
const assert = require("node:assert");
const { buildLines, buildReview, hashPw, checkPw, validNewPassword, validUsername } = require("../server");

test("hamper line uses the server price", () => {
  const [l] = buildLines([{ id: "classic", qty: 2 }]);
  assert.strictEqual(l.price * l.qty, 1598);
});
test("custom hamper is priced from the catalog", () => {
  const [l] = buildLines([{ qty: 1, custom: { base: "Nuts", box: "m", q: { almond: 2, pista: 1 } } }]);
  assert.strictEqual(l.price, 750);
  assert.deepStrictEqual(l.recipe.q, { almond: 2, pista: 1 });
});
test("bad carts are rejected", () => {
  assert.throws(() => buildLines([]));
  assert.throws(() => buildLines([{ id: "nope", qty: 1 }]));
  assert.throws(() => buildLines([{ id: "classic", qty: 0 }]));
  assert.throws(() => buildLines([{ qty: 1, custom: { base: "Mix of all", box: "s", q: { almond: 4 } } }]));
  assert.throws(() => buildLines([{ qty: 1, custom: { base: "Nuts", box: "m", q: { milk: 1 } } }]));
});
test("reviews are validated", () => {
  assert.deepStrictEqual(buildReview({ h: "royal", n: " Sam ", s: 5, t: "Lovely box" }),
    { hamper: "royal", name: "Sam", rating: 5, body: "Lovely box" });
  assert.throws(() => buildReview({ h: "x", n: "a", s: 5, t: "long enough" }));
  assert.throws(() => buildReview({ h: "royal", n: "a", s: 9, t: "long enough" }));
  assert.throws(() => buildReview({ h: "royal", n: "a", s: 3, t: "ok" }));
});
test("passwords hash and verify", async () => {
  const h = await hashPw("goodpass1");
  assert.ok(await checkPw("goodpass1", h));
  assert.ok(!(await checkPw("wrongpass", h)));
  assert.notStrictEqual(h, await hashPw("goodpass1"));
});
test("credential rules", () => {
  assert.strictEqual(validUsername(" Rohan_T "), "rohan_t");
  assert.throws(() => validUsername("a b"));
  assert.throws(() => validNewPassword("short"));
  assert.strictEqual(validNewPassword("longenough"), "longenough");
});
