import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ── Schema parity ────────────────────────────────────────────────────────────
//
// The kiosk redeclares a SUBSET of dojo-planner's Drizzle tables locally (it
// shares the same physical Postgres database but does not import dojo-planner
// code). dojo-planner owns the schema and migrations; the kiosk must stay
// read-compatible but is never authoritative.
//
// There are two directions of drift, and they are NOT symmetric:
//
//   1. planner-only columns (planner has it, kiosk doesn't) — HARMLESS and
//      intentional. The kiosk deliberately skips organization.stripe_*,
//      catalog_item.*, member.photo_url and ~60 others it has no use for.
//      Gating on this would be permanently red. → reported, never fails.
//
//   2. kiosk-only columns (kiosk declares it, planner does NOT) — FATAL. The
//      column does not exist in the database, so any query touching it fails at
//      runtime with `column "x" does not exist`. TypeScript cannot catch this:
//      the kiosk compiles fine against its own declaration. → HARD FAILURE.
//
// Direction 2 is what a dojo-planner column rename or drop produces, and it is
// invisible to every other check in either repo. This test is the only gate.
//
// Scope:
//   - Only columns are compared, and only for tables declared in BOTH repos.
//   - Tables only one side declares are ignored (the kiosk has no say in
//     dojo-planner's table list, and kiosk-only tables aren't shared).
//   - If the dojo-planner checkout is absent the comparison cannot run; see
//     `hasDojoPlanner` below. Point it elsewhere with DOJO_PLANNER_DIR.

// Kiosk schema files that mirror dojo-planner tables.
const KIOSK_SCHEMA_FILES = [
  'src/lib/memberSchema.ts',
  'src/lib/catalogSchema.ts',
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

/**
 * Columns the kiosk declares that dojo-planner does not, per shared table.
 * A non-empty result means the kiosk would issue SQL referencing a column that
 * does not exist in the database.
 */
function findKioskOnlyColumns(
  planner: Map<string, Set<string>>,
  kiosk: Map<string, Set<string>>,
): string[] {
  const offenders: string[] = [];
  for (const [tableName, kioskCols] of kiosk) {
    const plannerCols = planner.get(tableName);
    if (!plannerCols) {
      // Table dojo-planner doesn't declare — not a shared table, not our call.
      continue;
    }
    const extra = [...kioskCols].filter(col => !plannerCols.has(col)).sort();
    if (extra.length > 0) {
      offenders.push(`  ${tableName}: ${extra.join(', ')}`);
    }
  }
  return offenders.sort();
}

/** Columns dojo-planner declares that the kiosk does not — informational. */
function findPlannerOnlyColumns(
  planner: Map<string, Set<string>>,
  kiosk: Map<string, Set<string>>,
): string[] {
  const report: string[] = [];
  for (const [tableName, kioskCols] of kiosk) {
    const plannerCols = planner.get(tableName);
    if (!plannerCols) {
      continue;
    }
    const missing = [...plannerCols].filter(col => !kioskCols.has(col)).sort();
    if (missing.length > 0) {
      report.push(`  ${tableName}: ${missing.join(', ')}`);
    }
  }
  return report.sort();
}

describe('schema parity with dojo-planner', () => {
  const hasDojoPlanner = existsSync(DOJO_PLANNER_SCHEMA);

  // ── THE GATE ───────────────────────────────────────────────────────────────
  // Fails the build when the kiosk declares a column dojo-planner has dropped
  // or renamed. This is the check that catches a schema change in the other
  // repo before it reaches production as a 500 on the payment path.
  it.skipIf(!hasDojoPlanner)(
    'declares no column that dojo-planner does not have',
    () => {
      const planner = extractTables(readFileSync(DOJO_PLANNER_SCHEMA, 'utf8'));
      const kiosk = loadKioskTables();
      const offenders = findKioskOnlyColumns(planner, kiosk);

      // The message carries the drift: vitest runs with `silent: true`, so a
      // console.warn here would be swallowed. Assertion messages always print.
      expect(
        offenders,
        offenders.length === 0
          ? ''
          : 'The kiosk declares columns that do not exist in dojo-planner\'s schema.\n'
            + 'These will fail at runtime with `column "..." does not exist` — TypeScript\n'
            + 'cannot catch this because the kiosk compiles against its own declaration.\n'
            + 'Either dojo-planner renamed/dropped them (update the kiosk to match) or the\n'
            + 'kiosk invented them (remove them).\n\n'
            + `${offenders.join('\n')}\n`,
      ).toEqual([]);
    },
  );

  // ── Informational: the harmless direction ──────────────────────────────────
  it.skipIf(!hasDojoPlanner)(
    'reports dojo-planner columns the kiosk does not declare (informational)',
    () => {
      const planner = extractTables(readFileSync(DOJO_PLANNER_SCHEMA, 'utf8'));
      const kiosk = loadKioskTables();
      const report = findPlannerOnlyColumns(planner, kiosk);

      if (report.length > 0) {
        // Intentionally not an assertion — the kiosk deliberately omits columns
        // it has no use for. Printed via stdout so `silent: true` doesn't eat it.
        process.stdout.write(
          '\n[schema-parity] dojo-planner declares columns the kiosk does not.\n'
          + 'This is expected for columns the kiosk does not use. Review when\n'
          + 'dojo-planner\'s schema changes and adopt any the kiosk now needs:\n'
          + `${report.join('\n')}\n\n`,
        );
      }

      expect(report).toBeInstanceOf(Array);
    },
  );

  it('sanity-checks the parser against the kiosk memberSchema', () => {
    // Guards against the parser silently matching nothing, which would make the
    // gate above vacuously pass.
    const kiosk = loadKioskTables();
    expect(kiosk.get('member')?.has('organization_id')).toBe(true);
    expect(kiosk.get('signed_waiver')?.has('signature_data_url')).toBe(true);
  });

  it.skipIf(hasDojoPlanner)(
    'warns loudly that the gate did not run without a dojo-planner checkout',
    () => {
      process.stdout.write(
        `\n[schema-parity] GATE SKIPPED — dojo-planner schema not found at ${DOJO_PLANNER_SCHEMA}.\n`
        + 'The kiosk-only-column gate did NOT run. Set DOJO_PLANNER_DIR to a\n'
        + 'dojo-planner checkout to enable it (CI must check out both repos).\n\n',
      );
      expect(hasDojoPlanner).toBe(false);
    },
  );
});
