// A small in-memory Firestore (Admin SDK shape) for service tests: docs, where('==') queries, batches and
// transactions (writes applied only if the callback succeeds). Values are deep-cloned in and out; Dates stay Dates.
const clone = (v) => (v instanceof Date ? new Date(v.getTime()) : Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const autoId = () => Array.from({ length: 20 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');

export function createFakeFirestore(seed = {}) {
  const store = new Map(); // "coll/id" -> data
  for (const [coll, docs] of Object.entries(seed)) for (const [id, data] of Object.entries(docs)) store.set(`${coll}/${id}`, clone(data));

  const snap = (ref) => {
    const data = store.get(ref.path);
    return { id: ref.id, ref, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)) };
  };
  const write = {
    create: (ref, data) => { if (store.has(ref.path)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; } store.set(ref.path, clone(data)); },
    set: (ref, data, opts) => store.set(ref.path, opts?.merge ? { ...(store.get(ref.path) || {}), ...clone(data) } : clone(data)),
    update: (ref, patch) => { if (!store.has(ref.path)) { const e = new Error('NOT_FOUND'); e.code = 5; throw e; } store.set(ref.path, { ...store.get(ref.path), ...clone(patch) }); },
    delete: (ref) => store.delete(ref.path),
  };
  const docRef = (coll, id = autoId()) => {
    const ref = { id, path: `${coll}/${id}` };
    ref.get = async () => snap(ref);
    ref.create = async (d) => write.create(ref, d);
    ref.set = async (d, o) => write.set(ref, d, o);
    ref.update = async (p) => write.update(ref, p);
    ref.delete = async () => write.delete(ref);
    return ref;
  };
  const query = (coll, filters) => ({
    where: (field, op, value) => query(coll, [...filters, [field, op, value]]),
    get: async () => {
      const docs = [...store.keys()]
        .filter((k) => k.startsWith(`${coll}/`) && k.split('/').length === 2)
        .map((k) => docRef(coll, k.split('/')[1]))
        .filter((ref) => filters.every(([f, op, v]) => op === '==' && store.get(ref.path)?.[f] === v))
        .map(snap);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const db = {
    collection: (coll) => ({ doc: (id) => docRef(coll, id), where: (f, op, v) => query(coll, [[f, op, v]]), get: () => query(coll, []).get() }),
    batch: () => {
      const ops = [];
      return {
        create: (r, d) => ops.push(['create', r, d]),
        set: (r, d, o) => ops.push(['set', r, d, o]),
        update: (r, p) => ops.push(['update', r, p]),
        delete: (r) => ops.push(['delete', r]),
        commit: async () => {
          const backup = new Map(store);
          try { for (const [op, r, d, o] of ops) write[op](r, d, o); } catch (e) { store.clear(); backup.forEach((v, k) => store.set(k, v)); throw e; }
        },
      };
    },
    runTransaction: async (fn) => {
      const ops = [];
      const tx = {
        get: async (r) => snap(r),
        create: (r, d) => ops.push(['create', r, d]),
        set: (r, d, o) => ops.push(['set', r, d, o]),
        update: (r, p) => ops.push(['update', r, p]),
        delete: (r) => ops.push(['delete', r]),
      };
      const result = await fn(tx);
      const backup = new Map(store);
      try { for (const [op, r, d, o] of ops) write[op](r, d, o); } catch (e) { store.clear(); backup.forEach((v, k) => store.set(k, v)); throw e; }
      return result;
    },
    _store: store,
    _get: (path) => clone(store.get(path)),
    _all: (coll) => [...store.entries()].filter(([k]) => k.startsWith(`${coll}/`)).map(([k, v]) => ({ id: k.split('/')[1], ...clone(v) })),
  };
  return db;
}
