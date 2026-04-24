#!/usr/bin/env bun
/**
 * Crawls all law entries from https://deka.supremecourt.or.th/search/law
 * (Supreme Court case law index — 2,210 laws across 111 pages)
 * and stores them in a SQLite database.
 *
 * The site is server-rendered HTML with pagination at /search/law/{page}.
 * Each law row has an onclick="view('lawid', 'lawsname', 'lawfname')" handler.
 * Clicking a law POSTs to /search/section to get sections/deka (case rulings).
 *
 * Usage:
 *   bun run scrapling-js/crawl-deka-supremecourt.ts [--resume] [--delay 300] [--sections]
 */

import { Database } from "bun:sqlite";
import { parseArgs } from "util";

const BASE_URL = "https://deka.supremecourt.or.th";
const DEFAULT_DELAY_MS = 300;

const { values: args } = parseArgs({
  options: {
    resume: { type: "boolean", default: false },
    delay: { type: "string", default: String(DEFAULT_DELAY_MS) },
    sections: { type: "boolean", default: false },
  },
});
const DELAY_MS = parseInt(args.delay!, 10);

// --- Database setup ---
const DB_PATH = new URL("../output/deka-supremecourt.sqlite", import.meta.url).pathname;
const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode=WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS laws (
    law_id TEXT PRIMARY KEY,
    law_short_name TEXT,
    law_full_name TEXT,
    deka_count INTEGER,
    page_num INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_id TEXT NOT NULL,
    section_id TEXT,
    section_name TEXT,
    deka_count INTEGER,
    FOREIGN KEY (law_id) REFERENCES laws(law_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS crawl_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

const upsertLaw = db.prepare(`
  INSERT OR REPLACE INTO laws (law_id, law_short_name, law_full_name, deka_count, page_num)
  VALUES (?, ?, ?, ?, ?)
`);

const insertSection = db.prepare(`
  INSERT INTO sections (law_id, section_id, section_name, deka_count)
  VALUES (?, ?, ?, ?)
`);

const deleteSections = db.prepare(`DELETE FROM sections WHERE law_id = ?`);
const getState = db.prepare(`SELECT value FROM crawl_state WHERE key = ?`);
const setState = db.prepare(`INSERT OR REPLACE INTO crawl_state (key, value) VALUES (?, ?)`);

// --- Parse law list page ---
interface LawEntry {
  lawid: string;
  lawsname: string;
  lawfname: string;
  dekaCount: number;
}

function parseLawPage(html: string): LawEntry[] {
  const laws: LawEntry[] = [];
  // Match: view('lawid', 'lawsname', 'lawfname')
  const regex = /view\('([^']*)',\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    laws.push({
      lawid: match[1],
      lawsname: match[2].replace(/\\'/g, "'"),
      lawfname: match[3].replace(/\\'/g, "'"),
      dekaCount: 0,
    });
  }

  // Extract deka counts — malformed HTML, no closing </td> tags
  const countRegex = /<td[^>]*class="amount text-align"[^>]*>(\d+)/g;
  let countMatch;
  let i = 0;
  while ((countMatch = countRegex.exec(html)) !== null) {
    if (i < laws.length) {
      laws[i].dekaCount = parseInt(countMatch[1]) || 0;
    }
    i++;
  }

  return laws;
}

// --- Parse section page ---
interface SectionEntry {
  sectionId: string;
  sectionName: string;
  dekaCount: number;
}

function parseSectionPage(html: string): SectionEntry[] {
  const sections: SectionEntry[] = [];
  const regex = /viewdeka\('([^']*)',\s*'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    sections.push({
      sectionId: match[1],
      sectionName: match[2].replace(/\\'/g, "'"),
      dekaCount: 0,
    });
  }
  return sections;
}

// --- Fetch ---
async function fetchLawPage(page: number): Promise<string> {
  const url = `${BASE_URL}/search/law/${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchSectionPage(lawid: string, lawsname: string, lawfname: string): Promise<string> {
  const body = new URLSearchParams({
    lawid,
    lawsname,
    lawfname,
    search_word: "",
  }).toString();

  const res = await fetch(`${BASE_URL}/search/section`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for section ${lawid}`);
  return res.text();
}

// --- Detect total pages ---
function detectTotalPages(html: string): number {
  const matches = html.match(/\/search\/law\/(\d+)/g);
  if (!matches) return 1;
  let max = 1;
  for (const m of matches) {
    const num = parseInt(m.split("/").pop()!);
    if (num > max) max = num;
  }
  return max;
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
  const firstHtml = await fetchLawPage(startPage);
  const totalPages = detectTotalPages(firstHtml);
  const laws = parseLawPage(firstHtml);

  console.log(`Total pages: ${totalPages} (detected from pagination links)`);

  const saveLaws = db.transaction((entries: LawEntry[], page: number) => {
    for (const law of entries) {
      upsertLaw.run(law.lawid, law.lawsname, law.lawfname, law.dekaCount, page);
    }
  });

  saveLaws(laws, startPage);
  setState.run("last_page", String(startPage));
  console.log(`Page ${startPage}/${totalPages} — ${laws.length} laws`);

  for (let page = startPage + 1; page <= totalPages; page++) {
    await Bun.sleep(DELAY_MS);
    try {
      const html = await fetchLawPage(page);
      const pageLaws = parseLawPage(html);
      saveLaws(pageLaws, page);
      setState.run("last_page", String(page));

      if (page % 20 === 0 || page === totalPages) {
        const total = db.prepare("SELECT COUNT(*) as c FROM laws").get() as { c: number };
        console.log(`Page ${page}/${totalPages} — ${total.c} laws in DB`);
      }
    } catch (err) {
      console.error(`Error on page ${page}:`, err);
      console.log(`Saved at page ${page - 1}. Re-run with --resume to continue.`);
      throw err;
    }
  }

  // --- Optional: crawl sections for each law ---
  if (args.sections) {
    const allLaws = db.prepare("SELECT law_id, law_short_name, law_full_name FROM laws").all() as Array<{
      law_id: string;
      law_short_name: string;
      law_full_name: string;
    }>;

    const alreadyCrawled = new Set(
      (db.prepare("SELECT DISTINCT law_id FROM sections").all() as Array<{ law_id: string }>).map(r => r.law_id)
    );

    const remaining = allLaws.filter(l => !alreadyCrawled.has(l.law_id));
    console.log(`\nCrawling sections for ${remaining.length} laws (${alreadyCrawled.size} already done)...`);

    for (let i = 0; i < remaining.length; i++) {
      const law = remaining[i];
      await Bun.sleep(DELAY_MS);
      try {
        const html = await fetchSectionPage(law.law_id, law.law_short_name, law.law_full_name);
        const secs = parseSectionPage(html);

        if (secs.length > 0) {
          const tx = db.transaction(() => {
            deleteSections.run(law.law_id);
            for (const s of secs) {
              insertSection.run(law.law_id, s.sectionId, s.sectionName, s.dekaCount);
            }
          });
          tx();
        }

        if ((i + 1) % 100 === 0 || i === remaining.length - 1) {
          const sectionCount = db.prepare("SELECT COUNT(*) as c FROM sections").get() as { c: number };
          console.log(`Sections: ${i + 1}/${remaining.length} laws processed — ${sectionCount.c} sections in DB`);
        }
      } catch (err) {
        console.error(`Error on sections for ${law.law_id}:`, err);
      }
    }
  }

  const finalLaws = db.prepare("SELECT COUNT(*) as c FROM laws").get() as { c: number };
  const finalSections = db.prepare("SELECT COUNT(*) as c FROM sections").get() as { c: number };
  console.log(`\nDone! ${finalLaws.c} laws, ${finalSections.c} sections saved to ${DB_PATH}`);
}

main();
