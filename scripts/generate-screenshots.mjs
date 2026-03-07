/**
 * Generate template screenshots using Playwright.
 *
 * Reads public/templates.json, visits each template's vercelUrl,
 * and saves a 1280×800 viewport screenshot to public/screenshots/{id}.png.
 *
 * Usage:  node scripts/generate-screenshots.mjs
 *         pnpm screenshots
 */

import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const TEMPLATES_PATH = join(ROOT, 'public', 'templates.json');
const SCREENSHOTS_DIR = join(ROOT, 'public', 'screenshots');

const VIEWPORT = { width: 1280, height: 800 };
const PAGE_TIMEOUT = 15_000; // 15 s networkidle timeout
const EXTRA_WAIT = 2_000; // 2 s for JS-rendered content

async function main() {
  // ── Load templates ──────────────────────────────────────────────
  const raw = await readFile(TEMPLATES_PATH, 'utf-8');
  const templates = JSON.parse(raw);

  console.log(`\nFound ${templates.length} template(s) in templates.json\n`);

  // ── Ensure output directory exists ──────────────────────────────
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  // ── Launch browser ──────────────────────────────────────────────
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const template of templates) {
    const { id, name, vercelUrl } = template;

    // Skip templates without a URL
    if (!vercelUrl) {
      console.log(`⊘  Skipped "${name}" (${id}) — no vercelUrl`);
      skipped++;
      continue;
    }

    try {
      const page = await context.newPage();

      await page.goto(vercelUrl, {
        waitUntil: 'networkidle',
        timeout: PAGE_TIMEOUT,
      });

      // Extra wait for JS-rendered content
      await page.waitForTimeout(EXTRA_WAIT);

      const outPath = join(SCREENSHOTS_DIR, `${id}.png`);
      await page.screenshot({ path: outPath, type: 'png' });
      await page.close();

      console.log(`✓  ${name} (${id}) → screenshots/${id}.png`);
      succeeded++;
    } catch (error) {
      console.error(`✗  ${name} (${id}) — ${error.message}`);
      failed++;
    }
  }

  await browser.close();

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n--- Summary ---');
  console.log(`  Succeeded : ${succeeded}`);
  console.log(`  Failed    : ${failed}`);
  console.log(`  Skipped   : ${skipped} (no URL)`);
  console.log();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
