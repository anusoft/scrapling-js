#!/usr/bin/env bun
/**
 * Crawls all laws from https://www.ocs.go.th/searchlaw-law (Office of the Council of State)
 * and stores them in a SQLite database.
 *
 * The site exposes a POST API at /searchlaw/indexs/list_table_search with form-encoded params.
 * Categories: 10 (Constitution), 1A (Organic), 1B (Act), 1C (Decree), 1D (Code),
 *             1I,1J,1K,1L (NCPO orders), 2A, 1H
 *
 * Usage:
 *   bun run scrapling-js/crawl-ocs-go-th.ts [--resume] [--page-size 100] [--delay 500]
 */

import { Database } from "bun:sqlite";
import { parseArgs } from "util";

const API_URL = "https://www.ocs.go.th/searchlaw/indexs/list_table_search";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_DELAY_MS = 500;

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
const DB_PATH = new URL("../output/ocs-go-th.sqlite", import.meta.url).pathname;
const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS laws (
    law_code TEXT PRIMARY KEY,
    law_name_th TEXT,
    law_name_en TEXT,
    content_law TEXT,
    year INTEGER,
    publish_date TEXT,
    state TEXT,
    enc_timeline_id TEXT,
    file_uuid TEXT,
    finish_no TEXT,
    childrens TEXT,
    detail_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
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
    (law_code, law_name_th, law_name_en, content_law, year, publish_date,
     state, enc_timeline_id, file_uuid, finish_no, childrens, detail_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getState = db.prepare(`SELECT value FROM crawl_state WHERE key = ?`);
const setState = db.prepare(`INSERT OR REPLACE INTO crawl_state (key, value) VALUES (?, ?)`);

// --- Types ---
interface LawRow {
  lawCode: string;
  lawNameTh: string;
  lawNameEn: string | false;
  contentlaw: string;
  year: number;
  publishDate: string;
  state: string;
  encTimelineID: string;
  fileUUID: string;
  finishNo: string[];
  childrens: string;
  num: number;
}

interface ApiResponse {
  meta: {
    page: string;
    perpage: string;
    total: number;
    pages: number;
    start: number;
  };
  data: LawRow[];
}

// --- API ---
async function fetchPage(page: number): Promise<ApiResponse> {
  const body = new URLSearchParams({
    "query[letter]": "",
    "query[tab_type]": "law",
    "query[type_view]": "law",
    "query[q]": "",
    "query[sort]": "date-desc",
    "query[topic]": "1",
    "query[content]": "0",
    "query[sublaw]": "0",
    "query[lawCategoryName]": "",
    "query[stateName]": "",
    "query[year]": "",
    "query[acting]": "",
    "query[fNumber]": "",
    "query[param1]": "",
    "pagination[page]": String(page),
    "pagination[perpage]": String(PAGE_SIZE),
  }).toString();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.ocs.go.th/searchlaw-law",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function buildDetailUrl(encTimelineID: string): string {
  return `https://searchlaw.ocs.go.th/council-of-state/#/public/doc/${encTimelineID}`;
}

// --- Save ---
function saveRows(rows: LawRow[]) {
  const tx = db.transaction(() => {
    for (const row of rows) {
      upsertLaw.run(
        row.lawCode ?? null,
        row.lawNameTh ?? null,
        row.lawNameEn || null,
        row.contentlaw ?? null,
        row.year ?? null,
        row.publishDate ?? null,
        row.state ?? null,
        row.encTimelineID ?? null,
        typeof row.fileUUID === "string" ? row.fileUUID : null,
        row.finishNo ? JSON.stringify(row.finishNo) : null,
        typeof row.childrens === "string" ? (row.childrens || null) : JSON.stringify(row.childrens ?? null),
        row.encTimelineID ? buildDetailUrl(row.encTimelineID) : null
      );
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
  const total = first.meta.total;
  const lastPage = first.meta.pages;
  console.log(`Total laws: ${total}, pages: ${lastPage} (size=${PAGE_SIZE})`);

  saveRows(first.data);
  setState.run("last_page", String(startPage));
  console.log(`Page ${startPage}/${lastPage} — saved ${first.data.length} laws`);

  for (let page = startPage + 1; page <= lastPage; page++) {
    await Bun.sleep(DELAY_MS);
    try {
      const data = await fetchPage(page);
      saveRows(data.data);
      setState.run("last_page", String(page));

      const totalSaved = db.prepare("SELECT COUNT(*) as c FROM laws").get() as { c: number };
      if (page % 5 === 0 || page === lastPage) {
        console.log(`Page ${page}/${lastPage} — ${totalSaved.c} laws in DB`);
      }
    } catch (err) {
      console.error(`Error on page ${page}:`, err);
      console.log(`Saved progress at page ${page - 1}. Re-run with --resume to continue.`);
      throw err;
    }
  }

  const finalCount = db.prepare("SELECT COUNT(*) as c FROM laws").get() as { c: number };
  console.log(`\nDone! ${finalCount.c} laws saved to ${DB_PATH}`);
}

main();
