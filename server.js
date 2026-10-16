const express = require("express");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);
const path = require("path");
const os = require("os");
const { Pool } = require("pg");
const CAT = require("./catalog");

// ---- order validation: the server decides names and prices ----
function buildLines(items) {
  if (!Array.isArray(items) || !items.length || items.length > 30) throw new Error("Your cart is empty.");
  return items.map((it) => {
    const qty = it && it.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error("Invalid quantity.");
    if (it.custom) {
      const { base, box, q } = it.custom;
      const b = CAT.boxes[box];
      if (!b || !CAT.bases.includes(base) || !q || typeof q !== "object") throw new Error("Invalid custom hamper.");
      let grams = 0, price = b.price;
      const rq = {};
      const details = [];
      for (const [id, n] of Object.entries(q)) {
        const g = CAT.ing[id];
        if (!g || !Number.isInteger(n) || n < 1 || n > 8) throw new Error("Invalid custom hamper.");
        if (base !== "Mix of all" && g.group !== base) throw new Error("Invalid custom hamper.");
        grams += n * 100; price += n * g.per100g; details.push(`${g.name} ${n * 100} g`); rq[id] = n;
      }
      if (!grams || grams > b.grams) throw new Error("Invalid custom hamper.");
      return { sku: "custom", name: `Custom ${base === "Mix of all" ? "mixed" : base.toLowerCase()} hamper (${b.name} box)`, price, qty, details, recipe: { base, box, q: rq } };
    }
    const h = CAT.hampers[it.id];
    if (!h) throw new Error("Unknown hamper.");
    return { sku: it.id, name: h.name, price: h.price, qty, details: null, recipe: null };
  });
}
function buildReview(b) {
  b = b || {};
  const n = String(b.n || "").trim().slice(0, 60), t = String(b.t || "").trim().slice(0, 500);
  if (!CAT.hampers[b.h]) throw new Error("Choose a hamper.");
  if (!Number.isInteger(b.s) || b.s < 1 || b.s > 5) throw new Error("Choose a rating from 1 to 5.");
  if (!n || t.length < 5) throw new Error("Enter your name and a review of at least 5 characters.");
  return { hamper: b.h, name: n, rating: b.s, body: t };
}
async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + h.toString("hex");
}
async function checkPw(pw, stored) {
  const [t, s, h] = String(stored).split("$");
  if (t !== "scrypt") return false;
  const got = await scrypt(pw, Buffer.from(s, "hex"), 64), want = Buffer.from(h, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function validNewPassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) throw new Error("Use a password of at least 8 characters.");
  if (pw.length > 200) throw new Error("That password is too long.");
  return pw;
}
function validUsername(u) {
  u = String(u || "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(u)) throw new Error("Username must be 3 to 30 letters, numbers, dots, dashes or underscores.");
  return u;
}
module.exports = { buildLines, buildReview, hashPw, checkPw, validNewPassword, validUsername };
if (require.main !== module) return;

// ---- app ----
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });
const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, card_message TEXT,
  total_rupees INTEGER NOT NULL CHECK (total_rupees > 0),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL, name TEXT NOT NULL, unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99), details JSONB
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  hamper_id TEXT NOT NULL, reviewer_name TEXT NOT NULL, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_status_idx ON reviews (status, created_at DESC);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS recipe JSONB;
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bootstrap() {
  for (let i = 0; ; i++) {
    try { await pool.query("SELECT 1"); break; }
    catch (e) {
      if (i >= 29) throw new Error("Database unavailable");
      console.log("Waiting for the database..."); await sleep(2000);
    }
  }
  // Several replicas can start at once. An advisory lock lets only one at a time create tables and seed data.
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(727274)");
    await pool.query(SCHEMA);
    await seedAdmin();
    await seedReviews();
  } finally {
    await lock.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    lock.release();
  }
}

const app = express();
app.disable("x-powered-by");
// Behind a reverse proxy, set TRUST_PROXY=1 so rate limits use each visitor's real IP.
if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/config", (req, res) => res.json({ whatsapp: String(process.env.WHATSAPP_NUMBER || "").replace(/\D/g, "") || "910000000000" }));
app.get("/healthz", (req, res) => { res.set("X-Served-By", os.hostname()); res.send("ok"); });

// ---- accounts and sessions ----
const SESSION_DAYS = 30;
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
function readCookie(req, name) {
  const m = (req.get("cookie") || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setCookie(res, value, maxAge) {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.append("Set-Cookie", `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}
async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)", [sha(token), userId, String(SESSION_DAYS)]);
  setCookie(res, token, SESSION_DAYS * 86400);
}
app.use("/api", async (req, res, next) => {
  req.user = null;
  const sid = readCookie(req, "sid");
  if (sid) {
    try {
      req.sidHash = sha(sid);
      const r = await pool.query("SELECT u.id, u.username, u.role, u.must_change_password FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()", [req.sidHash]);
      req.user = r.rows[0] || null;
    } catch (e) { console.error(e); }
  }
  next();
});
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Please log in." }));
const userView = (u) => ({ username: u.username, role: u.role, mustChange: u.must_change_password });

app.get("/api/me", (req, res) => res.json({ user: req.user ? userView(req.user) : null }));

app.post("/api/register", async (req, res) => {
  if (authLimited(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
  try {
    const username = validUsername(req.body && req.body.username);
    const password = validNewPassword(req.body && req.body.password);
    const r = await pool.query("INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username, role, must_change_password", [username, await hashPw(password)]);
    await startSession(res, r.rows[0].id);
    res.json({ user: userView(r.rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is taken." });
    if (e.message && /^(Use a password|That password|Username)/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: "Could not create your account. Try again." });
  }
});

app.post("/api/login", async (req, res) => {
  if (authLimited(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
  const username = String((req.body && req.body.username) || "").trim().toLowerCase().slice(0, 30);
  const password = String((req.body && req.body.password) || "").slice(0, 200);
  try {
    const r = await pool.query("SELECT id, username, role, must_change_password, password_hash FROM users WHERE username = $1", [username]);
    const u = r.rows[0];
    const ok = u ? await checkPw(password, u.password_hash) : (await scrypt(password, Buffer.alloc(16), 64), false);
    if (!ok) return res.status(401).json({ error: "Wrong username or password." });
    await pool.query("DELETE FROM sessions WHERE expires_at < now()");
    await startSession(res, u.id);
    res.json({ user: userView(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not log you in. Try again." }); }
});

app.post("/api/logout", async (req, res) => {
  if (req.sidHash) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [req.sidHash]).catch(() => {});
  setCookie(res, "", 0);
  res.json({ ok: true });
});

app.post("/api/password", needUser, async (req, res) => {
  if (authLimited(req.ip)) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
  try {
    const cur = String((req.body && req.body.current) || "").slice(0, 200);
    const next = validNewPassword(req.body && req.body.next);
    const r = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!(await checkPw(cur, r.rows[0].password_hash))) return res.status(400).json({ error: "Your current password is wrong." });
    if (next === cur) return res.status(400).json({ error: "Choose a password different from the current one." });
    await pool.query("UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2", [await hashPw(next), req.user.id]);
    await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [req.user.id, req.sidHash]);
    res.json({ ok: true });
  } catch (e) {
    if (e.message && /^(Use a password|That password)/.test(e.message)) return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: "Could not change your password. Try again." });
  }
});

app.get("/api/my/orders", needUser, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.id, o.customer_name, o.phone, o.address, o.card_message, o.total_rupees, o.status, o.created_at,
             COALESCE(json_agg(json_build_object('sku', i.sku, 'name', i.name, 'qty', i.qty, 'unit_price', i.unit_price, 'details', i.details, 'recipe', i.recipe) ORDER BY i.id)
                      FILTER (WHERE i.id IS NOT NULL), '[]') AS items
      FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
      WHERE o.user_id = $1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 50`, [req.user.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load your orders." }); }
});

// small per-IP limit on new orders
const limiter = (max) => {
  const hits = new Map();
  return (ip) => {
    const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 60000);
    list.push(now); hits.set(ip, list);
    return list.length > max;
  };
};
const orderLimited = limiter(8), reviewLimited = limiter(5), authLimited = limiter(10);
const clean = (v, n) => String(v || "").trim().slice(0, n);

app.post("/api/orders", async (req, res) => {
  if (orderLimited(req.ip)) return res.status(429).json({ error: "Too many orders. Try again in a minute." });
  let lines;
  try { lines = buildLines(req.body && req.body.items); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const c = req.body.customer || {};
  const name = clean(c.name, 100), phone = clean(c.phone, 20), address = clean(c.address, 400), msg = clean(c.message, 200);
  if (!name || !phone || !address) return res.status(400).json({ error: "Enter your name, phone number and delivery address." });
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const o = await client.query(
      "INSERT INTO orders (customer_name, phone, address, card_message, total_rupees, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [name, phone, address, msg || null, total, req.user ? req.user.id : null]);
    for (const l of lines) {
      await client.query(
        "INSERT INTO order_items (order_id, sku, name, unit_price, qty, details, recipe) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [o.rows[0].id, l.sku, l.name, l.price, l.qty, l.details ? JSON.stringify(l.details) : null, l.recipe ? JSON.stringify(l.recipe) : null]);
    }
    await client.query("COMMIT");
    res.json({ orderNo: "CH-" + String(o.rows[0].id).padStart(4, "0"), total });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not save your order. Try again." });
  } finally { client.release(); }
});

// ---- reviews: public list shows approved only; new ones wait for approval ----
app.get("/api/reviews", async (req, res) => {
  try {
    const r = await pool.query("SELECT id, hamper_id AS h, reviewer_name AS n, rating AS s, body AS t FROM reviews WHERE status = 'approved' ORDER BY created_at DESC LIMIT 200");
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load reviews." }); }
});
app.post("/api/reviews", async (req, res) => {
  if (reviewLimited(req.ip)) return res.status(429).json({ error: "Too many reviews. Try again in a minute." });
  let v;
  try { v = buildReview(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    await pool.query("INSERT INTO reviews (hamper_id, reviewer_name, rating, body) VALUES ($1,$2,$3,$4)", [v.hamper, v.name, v.rating, v.body]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not save your review. Try again." }); }
});

// ---- admin (admin account only) ----
function admin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(401).json({ error: "Unauthorised" });
  if (req.user.must_change_password) return res.status(403).json({ error: "Change the default admin password first.", code: "CHANGE_PASSWORD" });
  next();
}
app.get("/api/admin/orders", admin, async (req, res) => {
  const r = await pool.query(`
    SELECT o.*, u.username AS account, COALESCE(json_agg(json_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price, 'details', i.details) ORDER BY i.id)
           FILTER (WHERE i.id IS NOT NULL), '[]') AS items
    FROM orders o LEFT JOIN order_items i ON i.order_id = o.id LEFT JOIN users u ON u.id = o.user_id
    GROUP BY o.id, u.username ORDER BY o.created_at DESC LIMIT 200`);
  res.json(r.rows);
});
app.patch("/api/admin/orders/:id", admin, async (req, res) => {
  const status = req.body && req.body.status;
  if (!["new", "confirmed", "delivered", "cancelled"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  const r = await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, parseInt(req.params.id, 10)]);
  res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
});

app.get("/api/admin/reviews", admin, async (req, res) => {
  const r = await pool.query("SELECT id, hamper_id, reviewer_name, rating, body, status, created_at FROM reviews ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 300");
  res.json(r.rows);
});
app.patch("/api/admin/reviews/:id", admin, async (req, res) => {
  const status = req.body && req.body.status;
  if (!["pending", "approved"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  const r = await pool.query("UPDATE reviews SET status = $1 WHERE id = $2", [status, parseInt(req.params.id, 10)]);
  res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
});
app.delete("/api/admin/reviews/:id", admin, async (req, res) => {
  const r = await pool.query("DELETE FROM reviews WHERE id = $1", [parseInt(req.params.id, 10)]);
  res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
});

// First run: create the admin account with the default password and force a change at first login.
async function seedAdmin() {
  if ((await pool.query("SELECT 1 FROM users WHERE username = 'admin'")).rowCount) return;
  await pool.query("INSERT INTO users (username, password_hash, role, must_change_password) VALUES ('admin', $1, 'admin', true) ON CONFLICT (username) DO NOTHING", [await hashPw(process.env.ADMIN_INITIAL_PASSWORD || "admin")]);
  console.warn("Created admin account (username: admin). Log in at /admin.html and change the password.");
}

// Optional demo data: set SEED_SAMPLE_REVIEWS=true to add sample reviews once, when the table is empty.
async function seedReviews() {
  if (process.env.SEED_SAMPLE_REVIEWS !== "true") return;
  if ((await pool.query("SELECT 1 FROM reviews LIMIT 1")).rowCount) return;
  const rows = [
    ["classic", "Ananya R.", 5, "Sent this to my sister for her birthday. She loved the hazelnut ones and the handwritten card."],
    ["dark", "Vikram S.", 5, "Properly bitter dark chocolate, not sugary. The nibs were a nice surprise."],
    ["festive", "Meera K.", 4, "Gave these to relatives at Diwali. The saffron bark disappeared first."],
    ["kids", "Farhan A.", 5, "The mug was a hit at my daughter's party."],
    ["corp", "Priya N.", 4, "Ordered for a team of 20. Easy to hand out, arrived neatly packed."],
    ["lux", "Rahul D.", 5, "Worth it for an anniversary. The box looks great on its own."],
  ];
  for (const r of rows) await pool.query("INSERT INTO reviews (hamper_id, reviewer_name, rating, body, status) VALUES ($1,$2,$3,$4,'approved')", r);
}

bootstrap().then(() => app.listen(process.env.PORT || 3000, () => console.log("Chocoholics running")))
  .catch((e) => { console.error(e); process.exit(1); });
