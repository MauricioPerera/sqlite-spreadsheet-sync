#!/usr/bin/env node
// Smoke driver for SQLite Spreadsheet Sync.
// Drives the Express REST API (the core of the app) end-to-end.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const PORT = process.env.SMOKE_PORT || '3999';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  PASS  ${m}`); };
const bad = (m) => { fail++; console.error(`  FAIL  ${m}`); };
function assert(cond, m) { cond ? ok(m) : bad(m); }

async function reachable(url) {
  try { const r = await fetch(`${url}/api/tables`); return r.ok; } catch { return false; }
}

async function waitFor(url, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await reachable(url)) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  let child = null;
  let usedExisting = await reachable(BASE_URL);

  if (!usedExisting) {
    console.log(`No server at ${BASE_URL} — spawning node server.js on PORT=${PORT}`);
    child = spawn('node', ['server.js'], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (!(await waitFor(BASE_URL))) {
      bad(`server never became reachable at ${BASE_URL}`);
      child.kill();
      process.exit(1);
    }
  } else {
    console.log(`Reusing server already running at ${BASE_URL}`);
  }

  const table = `_smoke_${Date.now()}`;

  try {
    let r = await fetch(`${BASE_URL}/api/tables`);
    let j = await r.json();
    assert(j.success && Array.isArray(j.tables), `GET /api/tables -> ${j.tables?.length} tables`);

    r = await fetch(`${BASE_URL}/api/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: table, columns: [
        { name: 'nombre', type: 'TEXT' },
        { name: 'cantidad', type: 'INTEGER' },
      ] }),
    });
    j = await r.json();
    assert(j.success, `POST /api/tables created "${table}"`);

    r = await fetch(`${BASE_URL}/api/tables/${table}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'tornillo', cantidad: 10 }),
    });
    j = await r.json();
    const rowid = j.rowid;
    assert(j.success && rowid, `POST row -> rowid ${rowid}`);

    r = await fetch(`${BASE_URL}/api/tables/${table}/rows/${rowid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnName: 'cantidad', value: 99 }),
    });
    j = await r.json();
    assert(j.success && j.changes === 1, `PUT cell cantidad=99`);

    r = await fetch(`${BASE_URL}/api/tables/${table}/rows/${rowid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'tuerca', cantidad: 5 }),
    });
    j = await r.json();
    assert(j.success, `PATCH row {nombre,cantidad}`);

    r = await fetch(`${BASE_URL}/api/tables/${table}`);
    j = await r.json();
    const row = j.rows?.find(x => x._rowid === rowid);
    assert(row && row.nombre === 'tuerca' && row.cantidad === 5,
      `GET table reflects edits (nombre=${row?.nombre}, cantidad=${row?.cantidad})`);

    r = await fetch(`${BASE_URL}/api/export/${table}`);
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    assert(r.ok && ct.includes('spreadsheetml') && buf[0] === 0x50 && buf[1] === 0x4b,
      `GET /api/export -> xlsx (${buf.length} bytes, ${ct.split(';')[0]})`);

    r = await fetch(`${BASE_URL}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'row_created', url: 'https://example.com/hook', targetTable: table }),
    });
    j = await r.json();
    const hookId = j.id;
    assert(j.success && hookId, `POST webhook -> id ${hookId}`);

    r = await fetch(`${BASE_URL}/api/webhooks`);
    j = await r.json();
    assert(j.webhooks?.some(h => h.id === hookId), `GET webhooks contains id ${hookId}`);

    r = await fetch(`${BASE_URL}/api/webhooks/${hookId}`, { method: 'DELETE' });
    j = await r.json();
    assert(j.success, `DELETE webhook ${hookId}`);

    r = await fetch(`${BASE_URL}/api/tables/${table}`, { method: 'DELETE' });
    j = await r.json();
    assert(j.success, `DELETE table "${table}"`);
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    if (child) { child.kill(); }
  }

  console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
