/**
 * 内存版 D1：把 worker 里用到的 SQL 用 JS 实现一遍，
 * 让 API 逻辑可以在 Node 里跑（npm test / serve-mock.mjs 共用）。
 *
 * 注意：这是测试替身，不解析 SQL，按语句特征匹配。
 * worker/index.js 里改了 SQL 就要同步这里。
 */

export function makeD1() {
  const docs = new Map();
  const snapshots = [];
  let snapId = 0;
  const config = new Map();
  let attempts = [];

  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

  function run(sql, args) {
    const s = norm(sql);

    if (s.startsWith('SELECT rev, data FROM docs')) {
      return { kind: 'first', value: docs.get(args[0]) || null };
    }
    if (s.startsWith('SELECT rev FROM docs')) {
      const row = docs.get(args[0]);
      return { kind: 'first', value: row ? { rev: row.rev } : null };
    }
    if (s.startsWith('INSERT INTO docs') && s.includes('ON CONFLICT')) {
      const cur = docs.get('main');
      if (cur) docs.set('main', { rev: cur.rev + 1, data: args[0], updated_at: args[1] });
      else docs.set('main', { rev: 1, data: args[0], updated_at: args[1] });
      return { kind: 'run', changes: 1 };
    }
    if (s.startsWith('INSERT INTO docs')) {
      if (docs.has(args[0])) return { kind: 'run', changes: 0 };
      docs.set(args[0], { rev: 1, data: args[1], updated_at: args[2] });
      return { kind: 'run', changes: 1 };
    }
    if (s.startsWith('UPDATE docs SET rev = rev + 1')) {
      const [data, updatedAt, id, expected] = args;
      const cur = docs.get(id);
      if (!cur || cur.rev !== expected) return { kind: 'run', changes: 0 };
      docs.set(id, { rev: cur.rev + 1, data, updated_at: updatedAt });
      return { kind: 'run', changes: 1 };
    }
    if (s.startsWith('INSERT INTO snapshots')) {
      snapshots.push({ id: ++snapId, rev: args[0], data: args[1], created_at: args[2] });
      return { kind: 'run', changes: 1 };
    }
    if (s.startsWith('DELETE FROM snapshots')) {
      const keep = args[0];
      const sorted = snapshots.slice().sort((a, b) => b.id - a.id).slice(0, keep);
      const keepIds = new Set(sorted.map((r) => r.id));
      const before = snapshots.length;
      for (let i = snapshots.length - 1; i >= 0; i--) {
        if (!keepIds.has(snapshots[i].id)) snapshots.splice(i, 1);
      }
      return { kind: 'run', changes: before - snapshots.length };
    }
    if (s.startsWith('SELECT id, rev, created_at, LENGTH(data) AS size FROM snapshots')) {
      const results = snapshots.slice().sort((a, b) => b.id - a.id).slice(0, 50)
        .map((r) => ({ id: r.id, rev: r.rev, created_at: r.created_at, size: r.data.length }));
      return { kind: 'all', results };
    }
    if (s.startsWith('SELECT rev, data FROM snapshots')) {
      const row = snapshots.find((r) => r.id === args[0]) || null;
      return { kind: 'first', value: row ? { rev: row.rev, data: row.data } : null };
    }
    if (s.startsWith('SELECT value FROM config')) {
      const v = config.get(args[0]);
      return { kind: 'first', value: v === undefined ? null : { value: v } };
    }
    if (s.startsWith('INSERT INTO config')) {
      config.set(args[0], args[1]);
      return { kind: 'run', changes: 1 };
    }
    if (s.startsWith('SELECT COUNT(*) AS n FROM login_attempts')) {
      const n = attempts.filter((a) => a.ip === args[0] && a.ts > args[1]).length;
      return { kind: 'first', value: { n } };
    }
    if (s.startsWith('INSERT INTO login_attempts')) {
      attempts.push({ ip: args[0], ts: args[1] });
      return { kind: 'run', changes: 1 };
    }
    if (s.startsWith('DELETE FROM login_attempts WHERE ts <')) {
      const before = attempts.length;
      attempts = attempts.filter((a) => a.ts >= args[0]);
      return { kind: 'run', changes: before - attempts.length };
    }
    if (s.startsWith('DELETE FROM login_attempts WHERE ip =')) {
      const before = attempts.length;
      attempts = attempts.filter((a) => a.ip !== args[0]);
      return { kind: 'run', changes: before - attempts.length };
    }
    throw new Error('内存 D1 没实现这条 SQL：' + s);
  }

  return {
    prepare(sql) {
      const statement = (args) => ({
        bind: (...a) => statement(a),
        async first() { const o = run(sql, args); return o.kind === 'first' ? o.value : null; },
        async run() { const o = run(sql, args); return { meta: { changes: o.kind === 'run' ? o.changes : 0 } }; },
        async all() { const o = run(sql, args); return { results: o.kind === 'all' ? o.results : [] }; },
      });
      return statement([]);
    },
    _dump: { docs, snapshots, config, attempts },
  };
}
