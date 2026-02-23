// db.js - minimal IndexedDB layer (no deps)
const DB_NAME = 'ravito_denik';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;

      // Settings (single row id=1)
      if (!db.objectStoreNames.contains('settings')) {
        const s = db.createObjectStore('settings', { keyPath: 'id' });
        s.createIndex('id', 'id', { unique: true });
      }

      if (!db.objectStoreNames.contains('customers')) {
        const s = db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('updated_at', 'updated_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('jobs')) {
        const s = db.createObjectStore('jobs', { keyPath: 'id', autoIncrement: true });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('customer_id', 'customer_id', { unique: false });
        s.createIndex('updated_at', 'updated_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        s.createIndex('job_id', 'job_id', { unique: false });
        s.createIndex('work_date', 'work_date', { unique: false });
        s.createIndex('updated_at', 'updated_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('invoices')) {
        const s = db.createObjectStore('invoices', { keyPath: 'id', autoIncrement: true });
        s.createIndex('job_id', 'job_id', { unique: true }); // 1 invoice / 1 job
        s.createIndex('state', 'state', { unique: false });
        s.createIndex('number_ym', ['number_year','number_month'], { unique: false });
        s.createIndex('updated_at', 'updated_at', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map(n => [n, t.objectStore(n)]));
    const res = fn(stores, t);
    t.oncomplete = () => resolve(res);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function nowIso(){ return new Date().toISOString(); }

export async function ensureDefaults() {
  const db = await openDb();
  const existing = await getSettings();
  if (!existing) {
    await tx(db, ['settings'], 'readwrite', (s) => {
      s.settings.put({
        id: 1,
        language: 'cs',
        company_name: 'RAVITO',
        phone: '+420776829454',
        email: 'baronvonkoniggratz@centrum.cz',
        default_hour_rate: 650,
        invoice_due_days_default: 14,
        invoice_number_format: 'cccc/mm,rrrr',
        invoice_allow_redating: true
      });
    });
  }
}

export async function getSettings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['settings'], 'readonly');
    const req = t.objectStore('settings').get(1);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSettings(patch) {
  const db = await openDb();
  const cur = await getSettings() || { id: 1 };
  const next = { ...cur, ...patch, updated_at: nowIso() };
  await tx(db, ['settings'], 'readwrite', (s) => s.settings.put(next));
  return next;
}

export async function listJobs({ status = 'all', q = '' } = {}) {
  const db = await openDb();
  const ql = q.trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['jobs'], 'readonly');
    const store = t.objectStore('jobs');
    const req = store.getAll();
    req.onsuccess = () => {
      let rows = req.result || [];
      if (status !== 'all') rows = rows.filter(r => r.status === status);
      if (ql) rows = rows.filter(r => (r.title || '').toLowerCase().includes(ql) || (r.note||'').toLowerCase().includes(ql));
      rows.sort((a,b) => (b.updated_at||'').localeCompare(a.updated_at||''));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function createJob({ title, note = '', customer_id = null, hour_rate_default = null }) {
  const db = await openDb();
  const created_at = nowIso();
  let jobId;
  await tx(db, ['jobs','invoices'], 'readwrite', (s) => {
    const req = s.jobs.add({
      title, note, customer_id,
      status: 'open',
      hour_rate_default,
      created_at, updated_at: created_at
    });
    req.onsuccess = () => { jobId = req.result; };
    req.onerror = () => { throw req.error; };

    // create draft invoice for this job
    const inv = {
      job_id: null, // set after jobId known (we patch later)
      state: 'draft',
      issue_date: null,
      number_year: null,
      number_month: null,
      number_seq: null,
      number_text: null,
      due_days: null,
      exported_at: null,
      sent_at: null,
      issued_at: null,
      cancelled_at: null,
      cancelled_reason: null,
      created_at, updated_at: created_at,
      subtotal: 0, total: 0,
      period_from: null, period_to: null
    };
    // cannot set job_id yet; we add later in next microtask
    // We'll just create after transaction using jobId.
  });

  // Create invoice now with known jobId
  const db2 = await openDb();
  await tx(db2, ['invoices'], 'readwrite', (s) => {
    s.invoices.add({
      job_id: jobId,
      state: 'draft',
      issue_date: null,
      number_year: null,
      number_month: null,
      number_seq: null,
      number_text: null,
      due_days: null,
      exported_at: null,
      sent_at: null,
      issued_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at, updated_at: created_at,
      subtotal: 0, total: 0,
      period_from: null, period_to: null
    });
  });

  return jobId;
}

export async function getJob(jobId) {
  const db = await openDb();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(['jobs'],'readonly');
    const req=t.objectStore('jobs').get(Number(jobId));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}

export async function updateJob(jobId, patch) {
  const db = await openDb();
  const cur = await getJob(jobId);
  if (!cur) throw new Error('Job not found');
  const next = { ...cur, ...patch, updated_at: nowIso() };
  await tx(db, ['jobs'], 'readwrite', (s)=>s.jobs.put(next));
  return next;
}

export async function listEntries(jobId) {
  const db = await openDb();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(['entries'],'readonly');
    const store=t.objectStore('entries');
    const idx=store.index('job_id');
    const req=idx.getAll(IDBKeyRange.only(Number(jobId)));
    req.onsuccess=()=>{
      const rows=req.result||[];
      rows.sort((a,b)=>(b.work_date||'').localeCompare(a.work_date||'') || (b.time_from||'').localeCompare(a.time_from||''));
      resolve(rows);
    };
    req.onerror=()=>reject(req.error);
  });
}

function parseHM(hm){
  const [h,m]=hm.split(':').map(x=>parseInt(x,10));
  return h*60+m;
}

export function calcEntry({time_from,time_to,break_minutes,hour_rate}){
  const from=parseHM(time_from), to=parseHM(time_to);
  let mins=to-from;
  if (mins<0) mins = (24*60-from)+to; // overnight
  mins = Math.max(0, mins - (break_minutes||0));
  const hours = mins/60;
  const price = Math.round((hours*(hour_rate||0))*100)/100;
  return { minutes_total: mins, price_total: price };
}

export async function addEntry(jobId, data) {
  const db = await openDb();
  const created_at = nowIso();
  const calc = calcEntry(data);
  const row = {
    job_id: Number(jobId),
    work_date: data.work_date,
    time_from: data.time_from,
    time_to: data.time_to,
    break_minutes: Number(data.break_minutes||0),
    hour_rate: Number(data.hour_rate||0),
    activity: data.activity || '',
    ...calc,
    created_at, updated_at: created_at
  };
  await tx(db, ['entries'], 'readwrite', (s)=>s.entries.add(row));
  await recomputeInvoiceForJob(jobId);
  await updateJob(jobId, {}); // touch updated_at
}

export async function updateEntry(entryId, patch) {
  const db = await openDb();
  const cur = await new Promise((resolve,reject)=>{
    const t=db.transaction(['entries'],'readonly');
    const req=t.objectStore('entries').get(Number(entryId));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
  if (!cur) throw new Error('Entry not found');
  const next = { ...cur, ...patch, updated_at: nowIso() };
  const calc = calcEntry(next);
  next.minutes_total = calc.minutes_total;
  next.price_total = calc.price_total;
  await tx(db, ['entries'], 'readwrite', (s)=>s.entries.put(next));
  await recomputeInvoiceForJob(cur.job_id);
  await updateJob(cur.job_id, {});
}

export async function deleteEntry(entryId) {
  const db = await openDb();
  const cur = await new Promise((resolve,reject)=>{
    const t=db.transaction(['entries'],'readonly');
    const req=t.objectStore('entries').get(Number(entryId));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
  if (!cur) return;
  await tx(db, ['entries'], 'readwrite', (s)=>s.entries.delete(Number(entryId)));
  await recomputeInvoiceForJob(cur.job_id);
  await updateJob(cur.job_id, {});
}

export async function getInvoiceByJob(jobId) {
  const db = await openDb();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(['invoices'],'readonly');
    const idx=t.objectStore('invoices').index('job_id');
    const req=idx.get(Number(jobId));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}

export async function recomputeInvoiceForJob(jobId) {
  const inv = await getInvoiceByJob(jobId);
  if (!inv) return;
  const entries = await listEntries(jobId);
  let subtotal = 0;
  let from = null, to = null;
  for (const e of entries) {
    subtotal += Number(e.price_total||0);
    if (!from || e.work_date < from) from = e.work_date;
    if (!to || e.work_date > to) to = e.work_date;
  }
  subtotal = Math.round(subtotal*100)/100;
  const updated = { ...inv, subtotal, total: subtotal, period_from: from, period_to: to, updated_at: nowIso() };
  const db = await openDb();
  await tx(db, ['invoices'], 'readwrite', (s)=>s.invoices.put(updated));
}

function pad(n, w){ return String(n).padStart(w,'0'); }

export async function prepareInvoice(jobId, issue_date) {
  const inv = await getInvoiceByJob(jobId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.state === 'issued') throw new Error('Invoice already issued');
  if (inv.exported_at || inv.sent_at || inv.issued_at) throw new Error('Invoice locked');
  const settings = await getSettings();
  const d = new Date(issue_date);
  const y = d.getFullYear();
  const m = d.getMonth()+1;

  // next seq among prepared+issued for month/year
  const db = await openDb();
  const nextSeq = await new Promise((resolve,reject)=>{
    const t=db.transaction(['invoices'],'readonly');
    const store=t.objectStore('invoices');
    const req=store.getAll();
    req.onsuccess=()=>{
      const rows=req.result||[];
      const nums=rows.filter(r=>r.number_year===y && r.number_month===m && (r.state==='prepared'||r.state==='issued')).map(r=>r.number_seq||0);
      resolve((Math.max(0,...nums))+1);
    };
    req.onerror=()=>reject(req.error);
  });

  const number_text = `${pad(nextSeq,4)}/${pad(m,2)},${y}`;
  const updated = {
    ...inv,
    state:'prepared',
    issue_date,
    due_days: settings?.invoice_due_days_default ?? 14,
    number_year:y, number_month:m, number_seq: nextSeq, number_text,
    prepared_at: nowIso(),
    updated_at: nowIso()
  };
  await tx(db, ['invoices'], 'readwrite', (s)=>s.invoices.put(updated));
  await updateJob(jobId, { status: 'ready_to_invoice' });
  return updated;
}

export async function cancelPreparedInvoice(jobId, reason='') {
  const inv = await getInvoiceByJob(jobId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.state !== 'prepared') throw new Error('Only prepared invoices can be cancelled');
  if (inv.exported_at || inv.sent_at || inv.issued_at) throw new Error('Invoice locked');
  const { number_year:y, number_month:m, number_seq:seq } = inv;

  const db = await openDb();
  // Transactional-ish: IndexedDB doesn't support multi-step atomic easily across getAll+put,
  // but we do in one readwrite transaction.
  await tx(db, ['invoices'], 'readwrite', (s) => {
    const store = s.invoices;
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const rows = getAllReq.result || [];

      // 1) remove number from cancelled invoice (keep record)
      const cancelled = { ...inv,
        state:'draft',
        cancelled_at: nowIso(),
        cancel_reason: reason,
        number_year:null, number_month:null, number_seq:null, number_text:null,
        issue_date:null,
        updated_at: nowIso()
      };
      store.put(cancelled);

      // 2) shift down other prepared invoices in same month/year with higher seq (and not locked)
      rows
        .filter(r => r.state==='prepared' && r.number_year===y && r.number_month===m && (r.number_seq||0) > seq
                     && !r.exported_at && !r.sent_at && !r.issued_at)
        .sort((a,b)=>(a.number_seq||0)-(b.number_seq||0))
        .forEach(r=>{
          const newSeq = (r.number_seq||0)-1;
          const newText = `${pad(newSeq,4)}/${pad(m,2)},${y}`;
          store.put({ ...r, number_seq:newSeq, number_text:newText, updated_at: nowIso() });
        });
    };
  });

  await updateJob(jobId, { status: 'open' });
}

export async function issueInvoice(jobId) {
  const inv = await getInvoiceByJob(jobId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.state !== 'prepared') throw new Error('Invoice must be prepared first');
  if (inv.exported_at || inv.sent_at || inv.issued_at) throw new Error('Invoice locked');
  const db = await openDb();
  const updated = { ...inv, state:'issued', issued_at: nowIso(), updated_at: nowIso() };
  await tx(db, ['invoices'], 'readwrite', (s)=>s.invoices.put(updated));
  await updateJob(jobId, { status: 'awaiting_payment' });
  return updated;
}

export async function markInvoiceExported(jobId) {
  const inv = await getInvoiceByJob(jobId);
  if (!inv) return;
  const db = await openDb();
  const updated = { ...inv, exported_at: nowIso(), updated_at: nowIso() };
  await tx(db, ['invoices'], 'readwrite', (s)=>s.invoices.put(updated));
}

export async function markInvoiceSent(jobId) {
  const inv = await getInvoiceByJob(jobId);
  if (!inv) return;
  const db = await openDb();
  const updated = { ...inv, sent_at: nowIso(), updated_at: nowIso() };
  await tx(db, ['invoices'], 'readwrite', (s)=>s.invoices.put(updated));
}

export async function markPaid(jobId) {
  const job = await getJob(jobId);
  if (!job) return;
  await updateJob(jobId, { status: 'paid' });
}

export async function exportBackup() {
  const db = await openDb();
  const all = {};
  async function getAll(storeName){
    return new Promise((resolve,reject)=>{
      const t=db.transaction([storeName],'readonly');
      const req=t.objectStore(storeName).getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error);
    });
  }
  const settings = await getSettings();
  all.settings = settings;
  all.customers = await getAll('customers');
  all.jobs = await getAll('jobs');
  all.entries = await getAll('entries');
  all.invoices = await getAll('invoices');

  return {
    app: 'ravito-denik',
    schemaVersion: 1,
    exportedAt: nowIso(),
    data: all
  };
}

export async function wipeAndRestore(backupObj) {
  if (!backupObj || backupObj.app !== 'ravito-denik') throw new Error('Invalid backup file');
  const db = await openDb();
  const stores = ['settings','customers','jobs','entries','invoices'];
  await tx(db, stores, 'readwrite', (s)=>{
    for (const name of stores) s[name].clear();
  });
  const d = backupObj.data || {};
  await tx(db, ['settings'], 'readwrite', (s)=>{ if (d.settings) s.settings.put(d.settings); });
  // Re-insert arrays; keep ids as-is by using put
  for (const name of ['customers','jobs','entries','invoices']) {
    const rows = Array.isArray(d[name]) ? d[name] : [];
    await tx(db, [name], 'readwrite', (s)=>{ rows.forEach(r=>s[name].put(r)); });
  }
}
