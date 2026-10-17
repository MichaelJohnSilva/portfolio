const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

async function db(env, stmts) {
  const base = env.TURSO_URL.replace(/^libsql:\/\//, 'https://');
  const r = await fetch(base + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.TURSO_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: stmts.map(s => ({ type: 'execute', stmt: s })).concat([{ type: 'close' }]) })
  });
  if (!r.ok) throw new Error('db ' + r.status);
  const out = await r.json();
  if (out.results.some(x => x.type === 'error')) throw new Error('db error');
  return out;
}

const val = c => (c && c.value !== undefined ? c.value : null);

function clean(w) {
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    title: s(w.title, 80),
    category: s(w.category, 30) || 'Work',
    year: s(w.year, 9),
    description: s(w.description, 400),
    tech: Array.isArray(w.tech) ? w.tech.slice(0, 20).map(t => s(t, 40)) : [],
    link: /^https?:\/\//i.test(w.link || '') ? s(w.link, 300) : '',
    image: /^(https?:\/\/|images\/|data:image\/(jpeg|png|webp|gif);base64,)/i.test(w.image || '') ? String(w.image) : '',
    fit: w.fit === 'cover' ? 'cover' : 'contain'
  };
}

async function handle(request, env) {
  if (!env.TURSO_URL || !env.TURSO_TOKEN) return json({ error: 'Database not configured' }, 500);
  const url = new URL(request.url), m = request.method;
  const T = { sql: 'CREATE TABLE IF NOT EXISTS works (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)' };
  try {
    // public: list works
    if (m === 'GET' && !url.searchParams.has('auth')) {
      const r = await db(env, [T, { sql: 'SELECT id, data FROM works ORDER BY id DESC' }]);
      const rows = r.results[1].response.result.rows;
      return json(rows.map(x => Object.assign(JSON.parse(val(x[1])), { id: Number(val(x[0])) })));
    }

    // everything below needs the owner passcode
    if (!env.ADMIN_PASSCODE || request.headers.get('x-admin') !== env.ADMIN_PASSCODE) return json({ error: 'Unauthorized' }, 401);
    if (m === 'GET') return json({ ok: true });

    const id = Number(url.searchParams.get('id'));
    if (m === 'DELETE') {
      if (!id) return json({ error: 'Missing id' }, 400);
      await db(env, [T, { sql: 'DELETE FROM works WHERE id = ?', args: [{ type: 'integer', value: String(id) }] }]);
      return json({ ok: true });
    }

    if (m === 'POST' || m === 'PUT') {
      const text = await request.text();
      if (text.length > 900000) return json({ error: 'Too large' }, 413);
      let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
      const w = clean(body || {});
      if (!w.title) return json({ error: 'Title required' }, 400);
      const data = { type: 'text', value: JSON.stringify(w) };
      if (m === 'POST') {
        await db(env, [T, { sql: 'INSERT INTO works (data) VALUES (?)', args: [data] }]);
      } else {
        if (!id) return json({ error: 'Missing id' }, 400);
        await db(env, [T, { sql: 'UPDATE works SET data = ? WHERE id = ?', args: [data, { type: 'integer', value: String(id) }] }]);
      }
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'Server error' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/works') return handle(request, env);
    return env.ASSETS.fetch(request);
  }
};