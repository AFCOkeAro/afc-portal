#!/usr/bin/env node
// ---------------------------------------------------------------------------
// AFC migration rollback control gate.  AFC-266.
//
// WHY THIS EXISTS
//   AFC-253 found one instance of a class defect: a migration's down script
//   removed an evidence-preservation control and nothing in CI could see it.
//   The specific case was the NDPA s.40(2) breach register. Reversing
//   20261006_0002 dropped the DELETE and TRUNCATE guard triggers that
//   20261006_0002 itself had installed, and every tests/db/*.sql suite
//   asserted only the forward state, so the reversal passed. AFC-253 closed the
//   instance; this closes the class.
//
// THE RULE, PRECISELY
//   For every control object C dropped by rollback/<X>.down.sql, one of:
//
//     F1  the down script removes C's REFERENT -- the table C guards, or the
//         column C exists to police -- when this same migration created that
//         referent and this same script drops it. Nothing is left to protect,
//         which is what makes the drop a reversal rather than a disarm.
//     F1b a trigger whose function body reads only columns that this migration
//         added and this script drops. Same reasoning, resolved through the
//         trigger's function.
//     F2  the down script RE-CREATES C after the drop -- the pattern AFC-253
//         adopted for the evidence seal, and what the live 0002 down script
//         does today.
//     F4  C cannot be restored because its own definition references something
//         this script drops. Postgres forces the drop; refusing would leave the
//         script unrunnable.
//     F3  C is allowlisted in scripts/rollback-control-grandfathered.json with
//         a written reason and a named sign-off.
//
//   Anything else FAILS: a control over an object that survives the script,
//   removed and not put back. That is a register being disarmed by a rollback
//   nobody re-runs.
//
// WHY NOT "THE DOWN SCRIPT OWNS IT", WHICH LOOKS OBVIOUS
//   Ownership was the first rule written here and it is wrong, and the repo's
//   own history says so. At e9b2f2b^ -- AFC-264's parent commit -- 0002 created
//   the seal triggers and 0002's down script dropped them, and the register was
//   open. Under an ownership rule that defect reads as "own-migration" and
//   passes. Today 0001 owns the seal and 0002 re-asserts it, so an ownership
//   rule works on today's tree and cannot reproduce the bug it exists for. A
//   gate that passes its own motivating defect is worse than no gate.
//
//   The referent rule catches it on the real historical tree: at e9b2f2b^ the
//   seal triggers guard `incidents`, that table survives 0002's down script,
//   and the controls are not restored -- FAIL. Ownership is still reported,
//   because it is the sentence a reviewer wants when reading a failure, but it
//   is evidence rather than the verdict.
//
// WHAT COUNTS AS A CONTROL
//   DROP TRIGGER; DROP FUNCTION of a function that RETURNS trigger; DROP RULE;
//   ALTER TABLE ... DROP CONSTRAINT. DROP VIEW and DROP COLUMN on a data
//   column are not controls -- a view is a read model, a data column is data,
//   and a gate that cries on those teaches people to disable it.
//
// WHY IT IS NODE AND NOT BASH
//   Because it parses. The sibling bash gates match a regex against raw lines,
//   which is correct for "no file contains CREATE ROLE". This gate has to know
//   where a STATEMENT begins, and the SQL in this repo contains dollar-quoted
//   function bodies, single-quoted RAISE messages and nested comments, all of
//   which can contain the text "DROP TRIGGER" without containing the
//   statement. grep fires on a comment. scripts/run-db-tests.mjs is already a
//   Node gate with the same --self-test contract, so the pattern exists here.
//
// KNOWN LIMITS, STATED RATHER THAN HIDDEN
//   * A trigger function that no scanned file creates is not recognised as a
//     control. Its return type is not statically knowable.
//   * F1b reads the trigger function's body for column references. A guard
//     naming a column through an indirection the parser does not follow is not
//     resolved by F1b and must rely on F2, F3, or a human reading the output.
//   * Dynamic SQL built with format() and %I is not statically decidable.
//     EXECUTE 'DROP TRIGGER ...' with a literal IS followed; EXECUTE
//     format('DROP TRIGGER %I ON %I', a, b) is not.
//
// SELF-TEST
//   A gate nobody has watched fail is a gate nobody can trust (AFC-203).
//   `pnpm gate:self-test`. The negative case is AFC-253's own shape, built from
//   the real file history: 0002 creates the seal triggers, 0002's down script
//   drops them and does not put them back, `incidents` survives. The gate must
//   reject that, accept the same shape with the re-creation, ignore the same
//   words inside a comment or a string literal, and accept a reversal that
//   drops its referent.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const RULE = 'rollback-must-not-disarm'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const DEFAULT_SCHEMA = join(ROOT, 'services/directus/schema')
const DEFAULT_ALLOWLIST = join(ROOT, 'scripts/rollback-control-grandfathered.json')

const CONTROL_KINDS = new Set(['trigger', 'trigger-function', 'rule', 'constraint'])

// ---------------------------------------------------------------------------
// Tokenizer. Statements with comments removed, string literals kept verbatim,
// and dollar-quoted bodies captured to a side channel so a function body can
// never masquerade as a top-level statement.
// ---------------------------------------------------------------------------

function tokenize(sql) {
  const statements = []
  let buf = ''
  let line = 1
  let startLine = 1
  let started = false
  let i = 0
  const n = sql.length

  const push = () => {
    const text = buf.trim()
    if (text) statements.push({ line: startLine, text: normalizeWs(text) })
    buf = ''
    started = false
  }

  while (i < n) {
    const c = sql[i]
    const c2 = sql[i + 1]

    if (c === '\n') {
      line++
      buf += ' '
      i++
      continue
    }

    if (c === '-' && c2 === '-') {
      while (i < n && sql[i] !== '\n') i++
      buf += ' '
      continue
    }

    /* block comment, nested as PostgreSQL allows */
    if (c === '/' && c2 === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
          continue
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
          continue
        }
        if (sql[i] === '\n') {
          line++
          buf += ' '
        }
        i++
      }
      buf += ' '
      continue
    }

    // '...' with '' escape, and E'...' where backslash escapes apply
    if (c === "'" || ((c === 'E' || c === 'e') && c2 === "'" && !/[\w$]/.test(buf.slice(-1)))) {
      if (c !== "'") {
        buf += c
        i++
      }
      const backslashEscapes = c !== "'"
      buf += "'"
      i++
      while (i < n) {
        if (sql[i] === '\n') {
          line++
          buf += '\n'
          i++
          continue
        }
        if (backslashEscapes && sql[i] === '\\' && i + 1 < n) {
          buf += sql[i] + sql[i + 1]
          i += 2
          continue
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            buf += "''"
            i += 2
            continue
          }
          buf += "'"
          i++
          break
        }
        buf += sql[i]
        i++
      }
      continue
    }

    // $tag$ ... $tag$
    if (c === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const delim = tag[0]
        const close = sql.indexOf(delim, i + delim.length)
        const end = close === -1 ? n : close + delim.length
        let body = ''
        for (let k = i + delim.length; k < Math.max(i + delim.length, end - delim.length); k++) {
          if (sql[k] === '\n') {
            line++
            body += '\n'
          } else body += sql[k]
        }
        i = end
        buf += ` ${delim} ${body} ${delim} `
        started = true
        continue
      }
    }

    if (!started && !/\s/.test(c)) {
      started = true
      startLine = line
    }

    if (c === ';') {
      push()
      i++
      continue
    }

    buf += c
    i++
  }
  push()

  return statements
}

function normalizeWs(s) {
  return s.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Classification. Every regex is anchored at the start of a STATEMENT, and a
// statement is only ever what the tokenizer produced.
// ---------------------------------------------------------------------------

const QUALIFIED = '[A-Za-z_][A-Za-z0-9_$]*(?:\\.[A-Za-z_][A-Za-z0-9_$]*)*'
const BARE = '[A-Za-z_"][\\w$".]*'

const ident = (raw) => raw.replace(/"/g, '').toLowerCase()
const tail = (name) => name.split('.').pop()

// Columns dropped anywhere in a down script.
//
// ALTER TABLE takes a comma-separated action list, and both 0002's and 0005's
// down scripts use it:
//
//   ALTER TABLE incidents
//     DROP COLUMN IF EXISTS awareness_at_source,
//     DROP COLUMN IF EXISTS awareness_at;
//
// Matching only the first DROP COLUMN of a statement missed the second one, and
// since F1b requires EVERY referenced column to be accounted for, a missed
// column made a legitimate reversal look like a violation. Found by running the
// gate over the real tree.
function columnsDroppedBy(text) {
  const cols = new Set()
  const re = new RegExp(
    `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUALIFIED})\\s+([^;]*?)(?=;|$)`,
    'gi'
  )
  let m
  while ((m = re.exec(text)) !== null) {
    const actions = m[2]
    const colRe = new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})`, 'gi')
    let c
    while ((c = colRe.exec(actions)) !== null) cols.add(ident(c[1]))
  }
  return cols
}

function tablesDroppedBy(text) {
  const tables = new Set()
  const re = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})`, 'gmi')
  let m
  while ((m = re.exec(text)) !== null) tables.add(ident(m[1]))
  return tables
}

// A function's body, kept so F1b can read the columns a guard touches.
function bodiesByFunction(statements) {
  const bodies = new Map()
  for (const stmt of statements) {
    const m = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_"][\w$".]*)/i.exec(stmt.text)
    if (!m) continue
    // The tokenizer emits the body as ` $$ ... $$ ` with the tag on both sides.
    // A lazy match anchored on the FIRST tag pair finds it; a greedy one
    // matched from the opening tag to nothing and silently returned no body for
    // every function in the tree. Found by running the gate over the real tree.
    const parts = /(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\1/.exec(stmt.text)
    if (!parts) continue
    const name = tail(ident(m[1]))
    if (!bodies.has(name)) bodies.set(name, parts[2])
  }
  return bodies
}

// Which function a trigger executes.
function triggerFunction(text) {
  const m = new RegExp(`EXECUTE\\s+(?:FUNCTION|PROCEDURE)\\s+(${QUALIFIED})`, 'i').exec(text)
  return m ? tail(ident(m[1])) : null
}

// Control objects DROPPED by a statement. `triggerFunctions` gates DROP
// FUNCTION, because a return type is not in the DROP statement.
function droppedControls(stmt, triggerFunctions) {
  const out = []
  const t = stmt.text

  let m = new RegExp(`^DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?(${BARE})\\s+ON\\s+(${QUALIFIED})`, 'i').exec(t)
  if (m) out.push({ kind: 'trigger', name: ident(m[1]), table: ident(m[2]), line: stmt.line, text: t })

  m = new RegExp(`^DROP\\s+RULE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})\\s+ON\\s+(${QUALIFIED})`, 'i').exec(t)
  if (m) out.push({ kind: 'rule', name: ident(m[1]), table: ident(m[2]), line: stmt.line, text: t })

  m = new RegExp(
    `^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUALIFIED})\\s+DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})`,
    'i'
  ).exec(t)
  if (m) out.push({ kind: 'constraint', name: ident(m[2]), table: ident(m[1]), line: stmt.line, text: t })

  m = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([A-Za-z_"][\w$"]*)/i.exec(t)
  if (m && triggerFunctions.has(tail(ident(m[1])))) {
    out.push({ kind: 'trigger-function', name: ident(m[1]), table: null, line: stmt.line, text: t })
  }

  return out
}

// Objects CREATED by a statement: the ownership evidence, the restoration
// evidence, and the referent evidence for F1/F4.
function createdObjects(stmt) {
  const out = []
  const t = stmt.text

  let m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(${QUALIFIED})(.*)$`, 'is').exec(t)
  if (m) {
    const rest = m[2]
    const on = new RegExp(`\\bON\\s+(${QUALIFIED})`, 'i').exec(rest)
    // UPDATE OF awareness_at, awareness_at_source names the columns this guard
    // polices directly. That is stronger evidence than the function body and is
    // what lets F1b fire on a guard whose body is just RETURN NEW.
    const ofCols = new Set()
    const ofRe = /\b(?:BEFORE|AFTER|INSTEAD\s+OF)\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)(?:\s+OF\s+([A-Za-z_][\w$]*(?:\s*,\s*[A-Za-z_][\w$]*)*))?/gi
    let om
    while ((om = ofRe.exec(rest)) !== null) {
      if (!om[1]) continue
      for (const c of om[1].split(',')) ofCols.add(ident(c.trim()))
    }
    out.push({
      kind: 'trigger',
      name: ident(m[1]),
      table: on ? ident(on[1]) : null,
      fn: triggerFunction(t),
      guardColumns: ofCols,
      text: t,
      line: stmt.line,
    })
  }

  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_"][\w$".]*)/i.exec(t)
  if (m) out.push({ kind: 'function', name: ident(m[1]), returnsTrigger: /RETURNS\s+trigger\b/i.test(t), line: stmt.line })

  m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?RULE\\s+(${QUALIFIED})(.*)$`, 'is').exec(t)
  if (m) {
    const to = new RegExp(`\\bTO\\s+(${QUALIFIED})`, 'i').exec(m[2])
    out.push({ kind: 'rule', name: ident(m[1]), table: to ? ident(to[1]) : null, text: t, line: stmt.line })
  }

  m = new RegExp(
    `^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUALIFIED})\\s+ADD\\s+CONSTRAINT\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})(.*)$`,
    'is'
  ).exec(t)
  // `expr` is the definition AFTER the constraint name. F4 reads it to ask
  // "which columns does this check depend on", and reading the whole ALTER
  // TABLE statement instead would pick up the table name and the constraint
  // name as if they were columns.
  if (m) out.push({ kind: 'constraint', name: ident(m[2]), table: ident(m[1]), expr: m[3], text: t, line: stmt.line })

  return out
}

// Dynamic SQL with a literal: EXECUTE 'DROP TRIGGER ...'. The literal is
// unquoted and tokenized as SQL. A RAISE message containing the same words is
// not an EXECUTE and is never scanned.
function dynamicStatements(stmt) {
  const out = []
  const re = /\bEXECUTE\s+(?:format\s*\(\s*)?'((?:[^']|'')*)'/gi
  let m
  while ((m = re.exec(stmt.text)) !== null) {
    const literal = m[1].replace(/''/g, "'")
    for (const s of tokenize(literal)) out.push({ ...s, dynamic: true })
  }
  return out
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function sqlFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'rollback') continue
      sqlFiles(full, out)
    } else if (entry.name.endsWith('.sql')) {
      out.push(full)
    }
  }
  return out
}

function downFiles(dir, out = []) {
  const rollback = join(dir, 'rollback')
  if (!existsSync(rollback)) return out
  for (const entry of readdirSync(rollback, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith('.down.sql')) out.push(join(rollback, entry.name))
  }
  return out
}

const readStatements = (file) => tokenize(readFileSync(file, 'utf8'))

// ---------------------------------------------------------------------------
// Allowlist. Validated as strictly as the rule it excuses: an unknown field, a
// blank reason, a short reason, or an entry that matches nothing are all
// failures. An allowlist that cannot rot is the difference between an exemption
// and a bin.
// ---------------------------------------------------------------------------

const ALLOWLIST_KEYS = new Set(['migration', 'object', 'reason', 'authorisedBy', 'authorisedOn'])

function loadAllowlist(file) {
  const errors = []
  const entries = []
  if (!existsSync(file)) {
    errors.push({ text: `${file} does not exist. A gate whose excuse list can be deleted also cannot be reviewed.` })
    return { entries, errors }
  }

  let doc
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    errors.push({ text: `${file} is not valid JSON: ${e.message}` })
    return { entries, errors }
  }

  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries)) {
    errors.push({ text: `${file} has no "entries" array.` })
    return { entries, errors }
  }

  doc.entries.forEach((entry, idx) => {
    const where = `${basename(file)} entries[${idx}]`
    if (!entry || typeof entry !== 'object') {
      errors.push({ text: `${where} is not an object.` })
      return
    }
    const unknown = Object.keys(entry).filter((k) => !ALLOWLIST_KEYS.has(k))
    if (unknown.length) {
      errors.push({ text: `${where} has unknown field(s): ${unknown.join(', ')}. Remove it or extend the gate deliberately.` })
      return
    }
    for (const field of ['migration', 'object', 'reason', 'authorisedBy']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        errors.push({
          text: `${where} is missing "${field}". Every entry names the migration, the object, why it is safe, and who signed it off.`,
        })
        return
      }
    }
    if (entry.reason.trim().length < 40) {
      errors.push({
        text: `${where} reason is ${entry.reason.trim().length} characters. Write the sentence saying why this control may be dropped without being restored -- a short reason is a bin entry.`,
      })
      return
    }
    entries.push({ ...entry, _index: idx })
  })

  return { entries, errors }
}

// ---------------------------------------------------------------------------
// The evaluation
// ---------------------------------------------------------------------------

const key = (kind, name) => `${kind}:${tail(name)}`

function evaluate(schemaDir, allowlistFile, { rel } = {}) {
  // Paths are printed relative to the schema root, not to the repo root. Using
// ROOT here sliced the wrong prefix whenever the gate was pointed at a tree
// outside the repo (`--schema=`, which is how the real historical tree is
// checked), and every owner printed as an empty string -- so the failure said a
// control came "from no scanned file" when it had an owner. Found by running
// the gate over a `--schema=` tree.
const r = rel || ((p) => p.slice(schemaDir.length + 1))
  const migrationsDir = join(schemaDir, 'migrations')

  // Forward SQL, in application order: bootstrap, engine, then migrations by
  // filename. Three indexes are built over it:
  //   owners           -- earliest creator, reported as evidence on a failure
  //   triggerFunctions -- names whose function RETURNS trigger
  //   definitions      -- creation text, which carries a constraint's CHECK
  //                       expression for F4 and a trigger's function for F1b
  const owners = new Map()
  const triggerFunctions = new Set()
  const definitions = new Map()
  const functionBodies = new Map()

  const forwardFiles = [
    ...sqlFiles(join(schemaDir, 'bootstrap')),
    ...sqlFiles(join(schemaDir, 'engine')),
    ...sqlFiles(migrationsDir),
  ]

  for (const file of forwardFiles) {
    const stmts = readStatements(file)
    for (const [name, body] of bodiesByFunction(stmts)) if (!functionBodies.has(name)) functionBodies.set(name, body)
    for (const stmt of stmts) {
      for (const created of createdObjects(stmt)) {
        // A DROP and its matching CREATE inside the same forward file are the
        // idempotent-re-run pattern the migrations use:
        //
        //   DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
        //   CREATE TRIGGER incidents_no_delete ...
        //
        // Only the CREATE is an ownership claim. Recording the DROP's line as the
        // owner would make the report say a control came "from no scanned file"
        // -- actually from the line two above -- and it also decided F1/F1b
        // against the pre-fix tree using a definition captured at the wrong
        // line. Found by running the gate over the real history.
        if (created.kind === 'function') {
          if (created.returnsTrigger) triggerFunctions.add(tail(created.name))
          continue
        }
        const k = key(created.kind, created.name)
        if (!owners.has(k)) owners.set(k, { file, line: created.line, name: created.name })
        if (!definitions.has(k)) definitions.set(k, created)
      }
    }
  }

  // Which columns each forward file ADDS. F1 and F1b ask "did this migration
  // create the referent that is now going away", which is the difference
  // between a reversal and a disarm.
  const addedColumns = new Map() // file -> Set(column)
  for (const file of forwardFiles) {
    const cols = new Set()
    for (const stmt of readStatements(file)) {
      if (!/^ALTER\s+TABLE/i.test(stmt.text) && !/^CREATE\s+TABLE/i.test(stmt.text)) continue
      for (const c of statementsAddingColumns(stmt.text)) cols.add(c)
    }
    addedColumns.set(file, cols)
  }

  const findings = []
  const ledger = []
  const notes = []
  const allowlist = loadAllowlist(allowlistFile)
  const allowlistErrors = [...allowlist.errors]
  const usedEntries = new Set()
  let examined = 0

  for (const downFile of downFiles(migrationsDir)) {
    const upFile = join(migrationsDir, basename(downFile).replace(/\.down\.sql$/, '.sql'))
    const hasUp = existsSync(upFile)

    const downStmts = readStatements(downFile)
    const downText = downStmts.map((s) => s.text).join('\n')
    const droppedColumns = columnsDroppedBy(downText)
    const droppedTables = tablesDroppedBy(downText)

    // What this down script re-creates, and where. Restoration must come after
    // the drop, or the control is open at the end of the script.
    const restores = new Map()
    const downTriggerDrops = new Set()
    const drops = []
    for (const stmt of downStmts) {
      for (const cand of [stmt, ...dynamicStatements(stmt)]) {
        const found = droppedControls(cand, triggerFunctions)
        for (const d of found) {
          drops.push(d)
          if (d.kind === 'trigger') downTriggerDrops.add(key('trigger', d.name))
        }
      }
      for (const created of createdObjects(stmt)) {
        if (!CONTROL_KINDS.has(created.kind)) continue
        const k = key(created.kind, created.name)
        if (!restores.has(k)) restores.set(k, stmt.line)
      }
    }

    if (!hasUp) {
      notes.push(`${r(downFile)} has no up migration (${basename(upFile)}). Nothing to reconcile it against.`)
    }

    const addedByUp = hasUp ? addedColumns.get(upFile) || new Set() : new Set()

    // Triggers that exist after this script runs: created by forward SQL and
    // not dropped here, plus anything this script creates. A trigger function
    // with none of these left has no caller (F5).
    const survivingTriggers = new Map() // trigger name -> fn name
    for (const [tk, def2] of definitions) {
      if (def2.kind !== 'trigger' || !def2.fn) continue
      if (downTriggerDrops.has(tk)) {
        if (restores.has(tk)) survivingTriggers.set(tk, tail(def2.fn))
        continue
      }
      survivingTriggers.set(tk, tail(def2.fn))
    }
    const survivingCallers = new Set(survivingTriggers.values())

    for (const d of drops) {
      examined++
      const k = key(d.kind, d.name)
      const label = d.kind === 'trigger-function' ? `${d.name}()` : `${d.name}${d.table ? ` on ${d.table}` : ''}`
      const owner = owners.get(k)
      const def = definitions.get(k)

      const verdict = (v) => ledger.push({ down: r(downFile), line: d.line, object: label, kind: d.kind, owner: owner ? r(owner.file) : null, verdict: v })

      // F2 -- restored after the drop. The AFC-253 pattern.
      const restoredAt = restores.get(k)
      if (restoredAt !== undefined && restoredAt > d.line) {
        verdict(`restored at line ${restoredAt}`)
        continue
      }

      // F1 -- the guarded table is dropped by this script. Nothing is left for
      // the control to protect, so the drop is part of the reversal.
      if (d.table && droppedTables.has(d.table)) {
        verdict(`referent removed: ${d.table} is dropped by this script`)
        continue
      }

      // F1b -- the columns this guard polices were added by this migration and
      // are dropped by this script. `UPDATE OF awareness_at` is the direct
      // evidence; a trigger whose body reads the column is the fallback, and
      // the test is universal (EVERY referenced column must be dropped) so a
      // parser miss makes the rule stricter rather than looser.
      if (d.table && def) {
        let cols = def.guardColumns && def.guardColumns.size > 0 ? new Set(def.guardColumns) : null
        if (!cols && def.fn) {
          const body = functionBodies.get(tail(def.fn))
          if (body) cols = columnRefs(body)
        }
        if (cols && cols.size > 0 && [...cols].every((c) => droppedColumns.has(c) && addedByUp.has(c))) {
          verdict(`referent removed: ${[...cols].join(', ')} added by this migration and dropped by this script`)
          continue
        }
      }

      // F5 -- a trigger function with no surviving caller. A function whose only
      // callers are triggers this script also drops is unreachable once the
      // script ends, so removing it reverses nothing. This is the other half of
      // keeping the gate out of the bin business: the ordinary rollback drops
      // its own trigger functions and is not a violation.
      if (d.kind === 'trigger-function' && !survivingCallers.has(tail(d.name))) {
        verdict('no surviving caller: every trigger using it is dropped or re-created by this script')
        continue
      }

      // F1, second form -- a constraint defined over a column this script drops.
      // Postgres cannot restore the constraint without restoring that column,
      // so the drop is forced rather than chosen.
      if (d.kind === 'constraint' && def?.expr) {
        const cols = [...columnRefs(def.expr)]
        const gone = cols.filter((c) => droppedColumns.has(c))
        // ANY referenced column that this script drops makes the constraint
        // unrestorable: Postgres will not accept a CHECK over a column that is
        // not there. ONE is enough, not all of them.
        // incidents_reported_after_awareness is this case -- it reads
        // reported_at, which survives, and awareness_at, which does not.
        if (gone.length > 0) {
          verdict(`forced: reads ${gone.join(', ')}, which this script drops, so the constraint cannot be restored`)
          continue
        }
      }

      // F3 -- allowlist.
      const bare = label.split(' on ')[0]
      const entry = allowlist.entries.find(
        (e) => e.object.trim().toLowerCase() === bare.toLowerCase() && matchesMigration(e.migration, downFile)
      )
      if (entry) {
        verdict(`allowlisted: ${entry.authorisedBy}`)
        usedEntries.add(entry._index)
        continue
      }

      verdict('FAIL')
      findings.push({
        file: r(downFile),
        line: d.line,
        text: d.text.slice(0, 200),
        kind: d.kind,
        object: label,
        owner: owner ? r(owner.file) : null,
        ownerLine: owner ? owner.line : null,
        ownerIsDownFile: hasUp && owner ? owner.file === upFile : false,
        restoredAt: restoredAt ?? null,
        survivingTable: d.table ? !droppedTables.has(d.table) : null,
      })
    }
  }

  allowlist.entries.forEach((entry, idx) => {
    if (!usedEntries.has(idx)) {
      allowlistErrors.push({ text: `allowlist entry ${idx} ("${entry.migration}" / "${entry.object}") matches nothing in this tree. Delete it.` })
    }
  })

  return { findings, allowlistErrors, notes, examined, ledger }
}

// Identifiers that could be column references.
//
// String literals are stripped first. A plpgsql guard body is mostly an English
// error message -- 'incidents.awareness_at is immutable (NDPA s.40(2) clock
// origin)' -- and reading those words as column references made F1b
// unsatisfiable on the real tree. This was a gate defect, found by running the
// gate over the real tree rather than only over fixtures.
//
// Deliberately generous after that: F1b requires EVERY reference to be dropped,
// so a missed keyword makes the rule stricter rather than looser.
function columnRefs(text) {
  const out = new Set()
  const noStrings = text.replace(/'(?:[^']|'')*'/g, " '' ")
  const keywords = new Set([
    'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'new', 'old', 'tg_op', 'coalesce',
    'true', 'false', 'begin', 'return', 'raise', 'exception', 'if', 'then', 'else', 'end', 'case',
    'when', 'btrim', 'trim', 'length', 'now', 'current_timestamp', 'as', 'in', 'exists', 'between',
    'like', 'distinct', 'count', 'sum', 'min', 'max', 'array', 'cast', 'values', 'using', 'set',
    'language', 'plpgsql', 'trigger', 'errcode', 'restrict_violation', 'idx', 'tbl', 'schemaname',
    'tg_table_name', 'to_jsonb', 'jsonb', 'text', 'verbose', 'log', 'statement', 'level',
    'col', 'rel', 'new', 'old',
  ])
  const re = /\b([A-Za-z_][A-Za-z0-9_$]*)\b\s*(\()?/g
  let m
  while ((m = re.exec(noStrings)) !== null) {
    const word = m[1].toLowerCase()
    if (word.length < 3) continue
    if (keywords.has(word)) continue
    // A word immediately followed by `(` is a call, not a column reference.
    // That one rule retires CHECK (btrim(actor) <> '') correctly without
    // growing the keyword list every time a new function appears.
    if (m[2] === '(') continue
    out.add(word)
  }
  return out
}

// Columns a statement ADDs: ALTER TABLE ... ADD [COLUMN], and the body of a
// CREATE TABLE.
function statementsAddingColumns(text) {
  const out = new Set()
  let m = new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})\\s*\\((.*)$`, 'is').exec(text)
  if (m) {
    const body = m[2]
    const colRe = new RegExp(`^\\s*(${QUALIFIED})\\s+[A-Za-z]`, 'gmi')
    let c
    while ((c = colRe.exec(body)) !== null) {
      const w = c[1].toLowerCase()
      if (['constraint', 'primary', 'foreign', 'unique', 'check', 'exclude'].includes(w)) continue
      out.add(w)
    }
  }
  // Same comma-list problem as columnsDroppedBy. 0002 adds two columns in one
// ALTER TABLE, and reading only the first one left awareness_at_source looking
// like it came from an earlier migration, so F1b could not fire on the clock
// guards. Found by running the gate over the real tree.
const addRe = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUALIFIED})\\s+([^;]*?)(?=;|$)`, 'gi')
  while ((m = addRe.exec(text)) !== null) {
    const colRe = new RegExp(`ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})\\s+[A-Za-z"]`, 'gi')
    let c
    while ((c = colRe.exec(m[2])) !== null) {
      const w = ident(c[1])
      if (['constraint', 'primary', 'foreign', 'unique', 'check', 'exclude'].includes(w)) continue
      out.add(w)
    }
  }
  return out
}

function matchesMigration(spec, downFile) {
  const want = basename(downFile).replace(/\.down\.sql$/, '.sql')
  const s = spec.trim()
  return s === want || s === basename(downFile) || s === downFile
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(res) {
  console.log('Migration rollback control gate')
  console.log('')
  console.log(`  rule                        ${RULE}`)
  console.log(`  control drops examined      ${res.examined}`)

  if (res.ledger.length) {
    console.log('')
    console.log('  what it examined:')
    for (const row of res.ledger) {
      console.log(`    ${row.down}:${row.line}  ${row.object}  (${row.kind})`)
      console.log(`        first created by ${row.owner ?? 'no scanned file'}   ->   ${row.verdict}`)
    }
  }

  for (const note of res.notes) console.log(`  note: ${note}`)
  for (const err of res.allowlistErrors) console.log(`  ALLOWLIST: ${err.text}`)

  if (res.findings.length === 0) {
    if (res.allowlistErrors.length) return 1
    console.log('')
    console.log('  OK: no rollback script removes a control over a surviving object without restoring it.')
    return 0
  }

  console.log('')
  for (const f of res.findings) {
    console.log(`  FAIL ${f.file}:${f.line}`)
    console.log(`       ${f.text}`)
    console.log(`       object     ${f.object}  (${f.kind})`)
    console.log(
      f.owner
        ? `       created by ${f.owner}:${f.ownerLine}${f.ownerIsDownFile ? '  -- the same migration, which is not the point' : ''}`
        : '       created by no scanned file, so no rollback script may remove it'
    )
    console.log(`       referent   ${f.survivingTable === null ? 'n/a' : f.survivingTable ? `${f.survivingTable} survives this script` : 'dropped by this script'}`)
    console.log(`       restored   ${f.restoredAt === null ? 'nowhere in this script' : `line ${f.restoredAt}, but not after the drop`}`)
    console.log(`       rule       ${RULE}`)
  }

  console.log('')
  console.log('FAIL: a rollback script removes a control whose referent survives it, and does not put')
  console.log('the control back.')
  console.log('')
  console.log('This is the AFC-253 shape. Reversing a migration silently disarmed the NDPA s.40(2)')
  console.log('breach register, and every suite passed because they assert the forward state only.')
  console.log('')
  console.log('To fix this:')
  console.log('  1. Re-create the control after the drop, in the same down script. COPY the definition')
  console.log('     from the owning migration byte for byte -- a divergent error message breaks the')
  console.log('     expected 23001 in tests/db and any runbook that greps for it, which is how a guard')
  console.log('     stops being one.')
  console.log('  2. Or, if the control genuinely must not come back, record it in')
  console.log('     scripts/rollback-control-grandfathered.json with the migration, the object, the')
  console.log('     sentence saying why it is safe, and who signed it off.')
  return 1
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

// Built from the real file history at e9b2f2b^, AFC-264's parent commit: 0002
// creates the seal, 0002's down script drops it and never restores it, and the
// `incidents` table survives.
const UP_0001_SEAL = `
CREATE OR REPLACE FUNCTION incidents_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incidents rows are not deletable (breach register evidence).';
END $$;

CREATE OR REPLACE FUNCTION incidents_forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incidents cannot be truncated (breach register evidence).';
END $$;

CREATE TRIGGER incidents_no_delete BEFORE DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();

CREATE TRIGGER incidents_no_truncate BEFORE TRUNCATE ON incidents
  FOR EACH STATEMENT EXECUTE FUNCTION incidents_forbid_truncate();
`

const UP_0002_ARMED = `
-- 0002 owns the awareness_at column as well as the clock guard over it. That is
-- what makes dropping the column a reversal rather than a disarm.
ALTER TABLE incidents ADD COLUMN awareness_at timestamptz;

CREATE OR REPLACE FUNCTION incidents_guard_awareness() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END $$;

CREATE TRIGGER incidents_immutable_awareness BEFORE UPDATE OF awareness_at ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_guard_awareness();

CREATE OR REPLACE FUNCTION incidents_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incidents rows are not deletable (breach register evidence).';
END $$;

CREATE TRIGGER incidents_no_delete BEFORE DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();
`

const DOWN_ARMED = `
DROP TRIGGER IF EXISTS incidents_immutable_awareness ON incidents;
ALTER TABLE incidents DROP COLUMN IF EXISTS awareness_at;

-- The defect, as it stood at e9b2f2b^: the seal goes and nothing brings it back.
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
DROP FUNCTION IF EXISTS incidents_forbid_delete();
`

const DOWN_FIXED = `
DROP TRIGGER IF EXISTS incidents_immutable_awareness ON incidents;
ALTER TABLE incidents DROP COLUMN IF EXISTS awareness_at;

-- The fix AFC-253 adopted: drop the guard, then re-create it byte for byte.
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;

CREATE OR REPLACE FUNCTION incidents_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incidents rows are not deletable (breach register evidence).';
END $$;

CREATE TRIGGER incidents_no_delete BEFORE DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();
`

const DOWN_MENTIONS = `
DROP TRIGGER IF EXISTS incidents_immutable_awareness ON incidents;
ALTER TABLE incidents DROP COLUMN IF EXISTS awareness_at;

-- A comment that says DROP TRIGGER IF EXISTS incidents_no_delete ON incidents, and a
-- RAISE message that says the same thing. Neither is a statement.
DO $$
BEGIN
  RAISE NOTICE 'rollback dropped DROP TRIGGER incidents_no_delete ON incidents from the log';
END $$;
`

const EMPTY_ALLOWLIST = { rule: RULE, entries: [] }

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
}

function runCase(files, allowlist = EMPTY_ALLOWLIST) {
  const root = mkdtempSync(join(tmpdir(), 'afc-rollback-gate-'))
  try {
    const schemaDir = join(root, 'services/directus/schema')
    writeTree(schemaDir, files)
    const allowPath = join(root, 'allowlist.json')
    writeFileSync(allowPath, JSON.stringify(allowlist, null, 2))
    return evaluate(schemaDir, allowPath, { rel: (p) => p.slice(root.length + 1) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const baseTree = (down0002, up0002 = UP_0002_ARMED) => ({
  'bootstrap/0001_roles.sql': 'CREATE ROLE directus_app NOLOGIN;\n',
  'migrations/20261006_0001_incidents.sql': `CREATE TABLE incidents (id uuid PRIMARY KEY, reported_at timestamptz NOT NULL);\n${UP_0001_SEAL}`,
  'migrations/20261006_0002_incidents_awareness_at.sql': up0002,
  'migrations/rollback/20261006_0002_incidents_awareness_at.down.sql': down0002,
})

function selfTest() {
  let rc = 0
  const expect = (cond, okMsg, failMsg) => {
    if (cond) console.log(`  self-test ok: ${okMsg}`)
    else {
      console.log(`SELF-TEST FAIL: ${failMsg}`)
      rc = 1
    }
  }

  // 1. AFC-253's own shape, reproduced from e9b2f2b^. Must fail.
  const armed = runCase(baseTree(DOWN_ARMED))
  expect(
    armed.findings.some((f) => f.object.startsWith('incidents_no_delete')),
    'the AFC-253 shape is rejected: 0002 drops the seal and does not restore it',
    `expected a finding on incidents_no_delete, got ${JSON.stringify(armed.findings.map((f) => f.object))}`
  )
  expect(
    armed.findings.find((f) => f.object.startsWith('incidents_no_delete'))?.survivingTable === true,
    'the failure reports that incidents survives the down script',
    'the failure did not report the surviving referent'
  )
  expect(
    !armed.findings.some((f) => f.object.includes('incidents_immutable_awareness')),
    'a trigger guarding a column this migration adds and this script drops is accepted (F1b)',
    'the gate fired on a clock trigger whose referent column is dropped'
  )

  // 2. The fixed shape.
  const fixed = runCase(baseTree(DOWN_FIXED))
  expect(fixed.findings.length === 0, 'the same shape with the control re-created after the drop is accepted', `the gate rejected the fixed shape: ${JSON.stringify(fixed.findings.map((f) => f.object))}`)

  // 3. Not a grep.
  const mentions = runCase(baseTree(DOWN_MENTIONS))
  expect(
    mentions.findings.length === 0,
    'the words DROP TRIGGER inside a -- comment and inside a string literal are not statements',
    'the gate fired on the phrase DROP TRIGGER inside a comment or a string literal'
  )

  // 4. Dynamic SQL with a literal is followed.
  const dynamic = runCase(
    baseTree(`DO $x$\nBEGIN\n  EXECUTE 'DROP TRIGGER IF EXISTS incidents_no_delete ON incidents';\nEND\n$x$;\n`)
  )
  expect(
    dynamic.findings.some((f) => f.object.startsWith('incidents_no_delete')),
    "EXECUTE 'DROP TRIGGER ...' with a literal is followed and rejected",
    'the gate missed a control drop hidden in dynamic SQL'
  )

  // 5. The real AFC-264 shape: 0001 owns the seal, 0002 re-asserts it, 0002's down
  //    script drops and re-asserts it again. Clean.
  const reasserted = runCase({
    ...baseTree(DOWN_FIXED),
    'migrations/20261006_0002_incidents_awareness_at.sql': UP_0002_ARMED,
  })
  expect(reasserted.findings.length === 0, 'the re-asserted seal, restored by the down script, is accepted', 'the gate rejected the re-asserted seal')

  // 6. A reversal that drops its referent is clean. This is what keeps the gate
  //    from becoming a bin: every ordinary rollback is one of these.
  const referentGone = runCase({
    'migrations/20261006_0001_incidents.sql': `CREATE TABLE incidents (id uuid PRIMARY KEY);\n${UP_0001_SEAL}`,
    'migrations/rollback/20261006_0001_incidents.down.sql':
      'DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;\nDROP TRIGGER IF EXISTS incidents_no_truncate ON incidents;\nDROP FUNCTION IF EXISTS incidents_forbid_delete();\nDROP FUNCTION IF EXISTS incidents_forbid_truncate();\nDROP TABLE IF EXISTS incidents;\n',
  })
  expect(
    referentGone.findings.length === 0,
    'a down script that drops the guarded table along with the guard is accepted (F1)',
    `the gate fired on a rollback that removes its referent: ${JSON.stringify(referentGone.findings.map((f) => f.object))}`
  )

  // 7. Rules and constraints are controls; views and data columns are not.
  const kinds = runCase({
    'migrations/20261006_0001_incidents.sql': `
CREATE TABLE incidents (id uuid PRIMARY KEY, reported_at timestamptz NOT NULL, awareness_at timestamptz);
CREATE VIEW incidents_breach_clock AS SELECT id FROM incidents;
CREATE RULE incidents_no_delete_rule AS ON DELETE TO incidents DO INSTEAD NOTHING;
ALTER TABLE incidents ADD CONSTRAINT incidents_reported_after_awareness CHECK (reported_at IS NULL OR reported_at >= awareness_at);
${UP_0001_SEAL}
`,
    'migrations/rollback/20261006_0001_incidents.down.sql': `
DROP VIEW IF EXISTS incidents_breach_clock;
ALTER TABLE incidents DROP COLUMN IF EXISTS awareness_at;
DROP RULE IF EXISTS incidents_no_delete_rule ON incidents;
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_reported_after_awareness;
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
DROP TABLE IF EXISTS incidents;
`,
  })
  expect(
    kinds.findings.length === 0,
    'rule, constraint, trigger, view and data-column drops are each classified correctly',
    `misclassification: ${JSON.stringify(kinds.findings.map((f) => f.object))}`
  )

  // 7b. A constraint defined over a column that another migration added and a
  //     LATER migration drops. 0004 adds `actor`; 0005 adds a CHECK on it and
  //     0005's down script removes both. The constraint is not 0005's to
  //     restore, and it cannot be restored anyway because its column is going.
  //     This is the real tree's 0005 shape, found by running the gate over it.
  const inheritedColumn = runCase({
    'migrations/20261006_0004_retention.sql':
      "CREATE TABLE retention_runs (id uuid PRIMARY KEY);\nALTER TABLE retention_runs ADD COLUMN actor text;\n",
    'migrations/20261006_0005_retention_attribution.sql':
      'ALTER TABLE retention_runs\n  ADD CONSTRAINT retention_runs_actor_not_blank CHECK (btrim(actor) <> \'\');\n',
    'migrations/rollback/20261006_0005_retention_attribution.down.sql':
      "ALTER TABLE retention_runs\n  DROP CONSTRAINT IF EXISTS retention_runs_actor_not_blank;\nALTER TABLE retention_runs\n  DROP COLUMN IF EXISTS actor;\n",
  })
  expect(
    inheritedColumn.findings.length === 0,
    'a constraint defined over a column this script drops is accepted (F4), even when the column came from an earlier migration',
    `the gate fired on a constraint whose column the same script drops: ${JSON.stringify(inheritedColumn.findings.map((f) => f.object))}`
  )

  // 7c. The counter-case, which must NOT pass: the constraint is defined over
  //     only columns that survive the script. Then it is restorable, and
  //     dropping it is a real loss of a check.
  const survivesItsColumns = runCase({
    'migrations/20261006_0004_retention.sql':
      "CREATE TABLE retention_runs (id uuid PRIMARY KEY, actor text);\n",
    'migrations/20261006_0005_retention_attribution.sql':
      "ALTER TABLE retention_runs\n  ADD CONSTRAINT retention_runs_actor_not_blank CHECK (btrim(actor) <> '');\n",
    'migrations/rollback/20261006_0005_retention_attribution.down.sql':
      'ALTER TABLE retention_runs\n  DROP CONSTRAINT IF EXISTS retention_runs_actor_not_blank;\n',
  })
  expect(
    survivesItsColumns.findings.some((f) => f.kind === 'constraint'),
    'a constraint whose columns all survive the down script IS rejected',
    'the gate accepted a restorable constraint being dropped'
  )

  // 8. A foreign control, unrestored, is the same class -- different migration.
  const foreignRule = runCase({
    'migrations/20261006_0001_incidents.sql':
      "CREATE TABLE incidents (id uuid PRIMARY KEY);\nCREATE RULE incidents_no_delete_rule AS ON DELETE TO incidents DO INSTEAD NOTHING;\n",
    'migrations/20261006_0002_incidents_awareness_at.sql': 'ALTER TABLE incidents ADD COLUMN awareness_at timestamptz;\n',
    'migrations/rollback/20261006_0002_incidents_awareness_at.down.sql':
      'ALTER TABLE incidents DROP COLUMN IF EXISTS awareness_at;\nDROP RULE incidents_no_delete_rule ON incidents;\n',
  })
  expect(
    foreignRule.findings.some((f) => f.kind === 'rule'),
    "another migration's DROP RULE, unrestored over a surviving table, is rejected",
    'the gate did not treat a foreign DROP RULE over a surviving table as a violation'
  )

  // 9. Restoration must come AFTER the drop.
  const reordered = runCase({
    'migrations/20261006_0001_incidents.sql': `CREATE TABLE incidents (id uuid PRIMARY KEY);\n${UP_0001_SEAL}`,
    'migrations/20261006_0002_incidents_awareness_at.sql': UP_0002_ARMED,
    'migrations/rollback/20261006_0002_incidents_awareness_at.down.sql': `
CREATE TRIGGER incidents_no_delete BEFORE DELETE ON incidents FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
`,
  })
  expect(
    reordered.findings.some((f) => f.object.startsWith('incidents_no_delete')),
    're-creating the control BEFORE the drop does not satisfy the rule',
    'the gate accepted a control created before the drop, which leaves the register open at end of script'
  )

  // 10. The allowlist is not a bin.
  const badReason = runCase(baseTree(DOWN_ARMED), {
    rule: RULE,
    entries: [{ migration: '20261006_0002_incidents_awareness_at.sql', object: 'incidents_no_delete', reason: 'fine', authorisedBy: 'Coder' }],
  })
  expect(badReason.allowlistErrors.length === 1 && badReason.findings.length > 0, 'an allowlist entry with a one-word reason is rejected and does not excuse anything', 'a blank allowlist reason was accepted')

  const goodReason = runCase(baseTree(DOWN_ARMED), {
    rule: RULE,
    entries: [
      {
        migration: '20261006_0002_incidents_awareness_at.sql',
        object: 'incidents_no_delete',
        reason:
          'This entry exists so the self-test can prove the allowlist path works end to end. It is a fixture, not a ruling: the real tree must never need it, and a reviewer should delete it on sight.',
        authorisedBy: 'Coder (self-test fixture)',
      },
    ],
  })
  expect(goodReason.findings.length === 0, 'a fully documented allowlist entry does excuse the drop', 'a documented allowlist entry did not excuse the drop')
  expect(goodReason.allowlistErrors.length === 0, 'a fully documented allowlist entry produces no allowlist error', 'a documented allowlist entry produced an allowlist error')

  const unknownField = runCase(baseTree(DOWN_FIXED), {
    rule: RULE,
    entries: [
      {
        migration: '20261006_0002_incidents_awareness_at.sql',
        object: 'incidents_no_delete',
        reason: 'A reason long enough to pass the length rule and prove that an unknown field is what fails here rather than the reason.',
        authorisedBy: 'Coder (self-test fixture)',
        feelsFine: true,
      },
    ],
  })
  expect(unknownField.allowlistErrors.length === 1, 'an allowlist entry with an unknown field is rejected', 'an allowlist entry with an unknown field was accepted')

  const unused = runCase(baseTree(DOWN_FIXED), {
    rule: RULE,
    entries: [
      {
        migration: '20261006_0001_incidents.sql',
        object: 'incidents_no_delete',
        reason:
          'This entry matches nothing in this tree and exists so the self-test can prove that an unused entry is reported rather than sitting there silently for a year.',
        authorisedBy: 'Coder (self-test fixture)',
      },
    ],
  })
  expect(unused.allowlistErrors.length === 1, 'an allowlist entry that matches nothing is reported', 'an unused allowlist entry was accepted silently')

  return rc
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args.includes('--self-test')) {
  console.log('Migration rollback control gate self-test')
  process.exit(selfTest())
}

const schemaIdx = args.findIndex((a) => a.startsWith('--schema='))
const allowIdx = args.findIndex((a) => a.startsWith('--allowlist='))
const schemaDir = schemaIdx === -1 ? DEFAULT_SCHEMA : resolve(args[schemaIdx].slice('--schema='.length))
const allowFile = allowIdx === -1 ? DEFAULT_ALLOWLIST : resolve(args[allowIdx].slice('--allowlist='.length))

process.exit(report(evaluate(schemaDir, allowFile)))