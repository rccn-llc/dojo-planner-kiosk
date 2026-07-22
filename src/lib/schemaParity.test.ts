import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ── Schema parity report ─────────────────────────────────────────────────────
//
// The kiosk redeclares a SUBSET of dojo-planner's Drizzle tables locally (it
// shares the same physical Postgres database but does not import dojo-planner
// code). It intentionally declares only the columns it uses — so a strict
// "mirror every column" gate would be permanently red (the kiosk skips
// organization.stripe_*, catalog updated_at, etc. on purpose).
//
// This test therefore REPORTS drift rather than failing on it: it prints, per
// shared table, every dojo-planner column the kiosk does not declare. Scan that
// report when dojo-planner's schema changes to decide whether the kiosk needs a
// newly-added column (as it did for class.allow_walk_ins and
// payment_method.first_six/account_type). The parity
// assertion always passes; only the parser sanity check can fail.
//
// Scope:
//   - Only columns are compared, and only for tables declared in BOTH repos.
//   - EXTRA kiosk columns and tables only one side declares are ignored.
//   - If the dojo-planner checkout is absent, the parity report is skipped with
//     a clear message. Point it elsewhere with DOJO_PLANNER_DIR.

// Kiosk schema files that mirror dojo-planner tables.
const KIOSK_SCHEMA_FILES = [
  'src/lib/memberSchema.ts',
  'src/lib/catalogSchema.ts',
  'src/lib/kioskSchema.ts',
  'src/lib/iqproConfig.ts',
];

const DOJO_PLANNER_DIR = process.env.DOJO_PLANNER_DIR ?? join(process.cwd(), '..', 'dojo-planner');
const DOJO_PLANNER_SCHEMA = join(DOJO_PLANNER_DIR, 'src', 'models', 'Schema.ts');

// Column builders drizzle exposes; the first string arg is the physical column
// name, e.g. text('member_id') → 'member_id'.
const COLUMN_BUILDERS = ['text', 'integer', 'real', 'boolean', 'timestamp', 'numeric', 'json', 'jsonb', 'uuid', 'serial', 'varchar', 'date', 'bigint', 'doublePrecision'];

/**
 * Extract `pgTable('name', { ... })` blocks and the set of physical column
 * names inside each. Returns a map of tableName → Set<columnName>. When a table
 * is declared more than once (the kiosk historically did this), the columns are
 * merged — a column present in ANY declaration counts as declared.
 */
function extractTables(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const columnRe = new RegExp(`\\b(?:${COLUMN_BUILDERS.join('|')})\\(\\s*['"]([a-z0-9_]+)['"]`, 'g');
  // Match pgTable('name', ...) up to the matching close via a brace scan.
  const tableRe = /pgTable\(\s*['"]([a-z0-9_]+)['"]\s*,/g;

  let match: RegExpExecArray | null = tableRe.exec(source);
  while (match !== null) {
    const tableName = match[1]!;
    // Find the first `{` after the table name and scan to its matching `}`.
    const braceStart = source.indexOf('{', match.index);
    if (braceStart !== -1) {
      let depth = 0;
      let end = braceStart;
      for (let i = braceStart; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') {
          depth++;
        }
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = source.slice(braceStart, end + 1);
      const cols = tables.get(tableName) ?? new Set<string>();
      let colMatch: RegExpExecArray | null = columnRe.exec(body);
      while (colMatch !== null) {
        cols.add(colMatch[1]!);
        colMatch = columnRe.exec(body);
      }
      tables.set(tableName, cols);
    }
    match = tableRe.exec(source);
  }
  return tables;
}

function loadKioskTables(): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const rel of KIOSK_SCHEMA_FILES) {
    const path = join(process.cwd(), rel);
    if (!existsSync(path)) {
      continue;
    }
    const tables = extractTables(readFileSync(path, 'utf8'));
    for (const [name, cols] of tables) {
      const existing = merged.get(name) ?? new Set<string>();
      for (const c of cols) {
        existing.add(c);
      }
      merged.set(name, existing);
    }
  }
  return merged;
}

describe('schema parity with dojo-planner', () => {
  const hasDojoPlanner = existsSync(DOJO_PLANNER_SCHEMA);

  it.skipIf(!hasDojoPlanner)(
    'reports dojo-planner columns the kiosk does not declare (informational)',
    () => {
      const planner = extractTables(readFileSync(DOJO_PLANNER_SCHEMA, 'utf8'));
      const kiosk = loadKioskTables();

      const report: string[] = [];
      for (const [tableName, kioskCols] of kiosk) {
        const plannerCols = planner.get(tableName);
        if (!plannerCols) {
          // Table only the kiosk declares (e.g. a differently-named view) — skip.
          continue;
        }
        const missing = [...plannerCols].filter(col => !kioskCols.has(col));
        if (missing.length > 0) {
          report.push(`  ${tableName}: ${missing.join(', ')}`);
        }
      }

      if (report.length > 0) {
        console.warn(
          '[schema-parity] dojo-planner declares columns the kiosk does not (this is expected for '
          + 'columns the kiosk does not use; review when dojo-planner\'s schema changes and adopt any '
          + `the kiosk now needs — dojo-planner owns migrations):\n${report.join('\n')}`,
        );
      }

      // Informational only — never fails. Drift is surfaced via the log above.
      expect(true).toBe(true);
    },
  );

  it('sanity-checks the parser against the kiosk memberSchema', () => {
    // Guards against the parser silently matching nothing (which would make the
    // parity check vacuously pass).
    const kiosk = loadKioskTables();
    expect(kiosk.get('member')?.has('organization_id')).toBe(true);
    expect(kiosk.get('signed_waiver')?.has('signature_data_url')).toBe(true);
  });

  if (!hasDojoPlanner) {
    it('reports that the parity check was skipped', () => {
      console.warn(
        `[schema-parity] SKIPPED — dojo-planner schema not found at ${DOJO_PLANNER_SCHEMA}. `
        + 'Set DOJO_PLANNER_DIR to the dojo-planner checkout to enable the check.',
      );
      expect(hasDojoPlanner).toBe(false);
    });
  }
});
