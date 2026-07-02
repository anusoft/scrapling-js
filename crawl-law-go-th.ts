#!/usr/bin/env bun
/**
 * Crawls all laws from https://law.go.th/Laws via their API
 * and stores them in a SQLite database.
 *
 * Usage:
 *   bun run scrapling-js/crawl-law-go-th.ts [--resume] [--page-size 100] [--delay 500]
 */

import { Database } from "bun:sqlite";
import { parseArgs } from "util";

const API_URL = "https://apig.law.go.th/dga-user-service-phase2/law";
const API_KEY = "4nEZYvTwRFlUVn7aK85cZ2xSU83dOFai";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_DELAY_MS = 500;

// --- CLI args ---
const { values: args } = parseArgs({
  options: {
    resume: { type: "boolean", default: false },
    "page-size": { type: "string", default: String(DEFAULT_PAGE_SIZE) },
    delay: { type: "string", default: String(DEFAULT_DELAY_MS) },
  },
});
const PAGE_SIZE = parseInt(args["page-size"]!, 10);
const DELAY_MS = parseInt(args.delay!, 10);

// --- Database setup ---
const DB_PATH = new URL("../output/law-go-th.sqlite", import.meta.url).pathname;
const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA foreign_keys=ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS laws (
    law_id TEXT PRIMARY KEY,
    table_of_law_id TEXT,
    law_type_id INTEGER,
    hirachy_of_law_id INTEGER,
    category_id TEXT,
    status_id INTEGER,
    law_name_og TEXT,
    law_name_th TEXT,
    content_all TEXT,
    simple_description TEXT,
    agency_response TEXT,
    announce_url TEXT,
    annouce_date TEXT,
    effective_startdate TEXT,
    updatedate TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS law_files (
    id TEXT PRIMARY KEY,
    law_id TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    type TEXT,
    seq INTEGER,
    description TEXT,
    FOREIGN KEY (law_id) REFERENCES laws(law_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS law_virtues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_id TEXT NOT NULL,
    virtue_data TEXT,
    FOREIGN KEY (law_id) REFERENCES laws(law_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS crawl_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// --- Prepared statements ---
const upsertLaw = db.prepare(`
  INSERT OR REPLACE INTO laws
    (law_id, table_of_law_id, law_type_id, hirachy_of_law_id, category_id,
     status_id, law_name_og, law_name_th, content_all, simple_description,
     agency_response, announce_url, annouce_date, effective_startdate, updatedate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertFile = db.prepare(`
  INSERT OR REPLACE INTO law_files (id, law_id, file_path, file_name, type, seq, description)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertVirtue = db.prepare(`
  INSERT INTO law_virtues (law_id, virtue_data) VALUES (?, ?)
`);

const deleteVirtues = db.prepare(`DELETE FROM law_virtues WHERE law_id = ?`);

const getState = db.prepare(`SELECT value FROM crawl_state WHERE key = ?`);
const setState = db.prepare(`INSERT OR REPLACE INTO crawl_state (key, value) VALUES (?, ?)`);

// --- API fetch ---
interface LawFile {
  id: string;
  file_path: string;
  file_name: string;
  type: string;
  seq: number;
  description: string;
}

interface LawRow {
  law_id: string;
  table_of_law_id: string;
  law_type_id: number;
  hirachy_of_law_id: number;
  category_id: string;
  status_id: number;
  law_name_og: string;
  law_name_th: string;
  content_all: string;
  simple_description: string | null;
  agency_response: string;
  announce_url: string;
  annouce_date: string;
  effective_startdate: string;
  updatedate: string;
  content_files: LawFile[];
  virtues: unknown[];
}

interface ApiResponse {
  rows: LawRow[];
  total: string;
  lastPage: number;
  currPage: number;
}

async function fetchPage(page: number): Promise<ApiResponse> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      Accept: "application/json",
      Origin: "https://law.go.th",
      Referer: "https://law.go.th/",
    },
    body: JSON.stringify({
      type: null,
      agency: null,
      hirachy: null,
      size: PAGE_SIZE,
      page,
    }),
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Save rows ---
function saveRows(rows: LawRow[]) {
  const tx = db.transaction(() => {
    for (const row of rows) {
      upsertLaw.run(
        row.law_id,
        row.table_of_law_id,
        row.law_type_id,
        row.hirachy_of_law_id,
        row.category_id,
        row.status_id,
        row.law_name_og,
        row.law_name_th,
        row.content_all,
        row.simple_description,
        row.agency_response,
        row.announce_url,
        row.annouce_date,
        row.effective_startdate,
        row.updatedate
      );

      for (const f of row.content_files ?? []) {
        upsertFile.run(f.id, row.law_id, f.file_path, f.file_name, f.type, f.seq, f.description);
      }

      if (row.virtues?.length) {
        deleteVirtues.run(row.law_id);
        for (const v of row.virtues) {
          insertVirtue.run(row.law_id, JSON.stringify(v));
        }
      }
    }
  });
  tx();
}

// --- Main ---
async function main() {
  let startPage = 1;
  if (args.resume) {
    const saved = getState.get("last_page") as { value: string } | undefined;
    if (saved) {
      startPage = parseInt(saved.value, 10) + 1;
      console.log(`Resuming from page ${startPage}`);
    }
  }

  console.log(`Fetching page ${startPage}...`);
  const first = await fetchPage(startPage);
  const total = parseInt(first.total, 10);
  const lastPage = first.lastPage;
  console.log(`Total laws: ${total}, pages: ${lastPage} (size=${PAGE_SIZE})`);

  saveRows(first.rows);
  setState.run("last_page", String(startPage));
  console.log(`Page ${startPage}/${lastPage} — saved ${first.rows.length} laws`);

  for (let page = startPage + 1; page <= lastPage; page++) {
    await Bun.sleep(DELAY_MS);
    try {
      const data = await fetchPage(page);
      saveRows(data.rows);
      setState.run("last_page", String(page));

      const totalSaved = db.prepare("SELECT COUNT(*) as c FROM laws").get() as { c: number };
      if (page % 10 === 0 || page === lastPage) {
        console.log(`Page ${page}/${lastPage} — ${totalSaved.c} laws in DB`);
      }
    } catch (err) {
      console.error(`Error on page ${page}:`, err);
      console.log(`Saved progress at page ${page - 1}. Re-run with --resume to continue.`);
      throw err;
    }
  }

  const finalCount = db.prepare("SELECT COUNT(*) as c FROM laws").get() as { c: number };
  const fileCount = db.prepare("SELECT COUNT(*) as c FROM law_files").get() as { c: number };
  console.log(`\nDone! ${finalCount.c} laws, ${fileCount.c} files saved to ${DB_PATH}`);
}

main();
