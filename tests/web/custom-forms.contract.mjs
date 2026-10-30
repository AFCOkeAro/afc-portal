/**
 * AFC-897 contract — custom forms linked to modules using database data.
 *
 * Phase 1: a `custom_forms` register (name, linked module, schema jsonb)
 * whose field picker is DB-backed (live Directus introspection, never a
 * checked-in copy), a builder UI, and a renderer on each linked module
 * whose fills write through that module's own create grant. Versioning
 * and approvals are explicitly later: definitions are immutable except
 * delete.
 *
 * Run: node --test tests/web/custom-forms.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  CUSTOM_FORM_MODULES,
  isCustomFormModule,
  validateCustomFormFields,
  validateSubmissionValues,
} from '../../packages/shared/src/custom-form-definition.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
const sqlOf = (rel) => codeOf(rel).replace(/--[^\n]*/g, '')

const MIGRATION = 'services/directus/schema/migrations/20261030_0065_custom_forms.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261030_0065_custom_forms.down.sql'
const SUITE = 'tests/db/102_custom_forms.sql'

/** Live-column stand-ins shaped like the submissions route builds them. */
const VISITOR_LIVE = [
  { name: 'visitor_first_name', nullable: false, hasDefault: false },
  { name: 'visit_date', nullable: false, hasDefault: false },
  { name: 'email', nullable: true, hasDefault: false },
  { name: 'status', nullable: false, hasDefault: true },
  { name: 'branch', nullable: true, hasDefault: false },
]

describe('AFC-897 custom forms register', () => {
  it('creates one row per module-name pair with a closed module vocabulary', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS custom_forms/)
    assert.match(src, /custom_forms_name_once/)
    assert.match(
      src,
      /'visitors',\s*'people',\s*'households',\s*'welfare_cases',\s*'blessings',\s*'announcements',\s*'tasks'/s,
      'only the seven v1 linkable modules; events and marriage stay out',
    )
    assert.match(src, /btrim\(name\) <> ''/, 'blank names refused')
    assert.match(src, /custom_forms_schema_shape/)
  })

  it('grants UPDATE on name/schema only and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT UPDATE \(name, schema\)/)
    assert.match(src, /GRANT INSERT \(name, module, schema, created_by\)/)
    assert.match(src, /REVOKE ALL ON custom_forms FROM PUBLIC/)
  })

  it('the rollback refuses while definitions exist and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back custom forms/)
    assert.match(src, /DROP TABLE IF EXISTS custom_forms/)
  })

  it('suite 102 pins rerun, shape, grants and the shipped rollback', () => {
    const src = sqlOf(SUITE)
    assert.match(
      src,
      /services\/directus\/schema\/migrations\/20261030_0065_custom_forms\.sql/,
    )
    assert.match(
      src,
      /services\/directus\/schema\/migrations\/rollback\/20261030_0065_custom_forms\.down\.sql/,
    )
    assert.match(src, /102\.1: 0065 re-apply is a no-op/)
    assert.match(src, /102\.2: a module outside the v1 seven is refused/)
    assert.match(src, /102\.3: app cannot re-home a definition/)
    assert.match(src, /102\.4: down refuses while rows exist/)
  })
})

describe('AFC-897 DB-backed definition rules', () => {
  it('links only to the seven v1 modules', () => {
    assert.deepEqual(
      [...CUSTOM_FORM_MODULES],
      [
        'visitors',
        'people',
        'households',
        'welfare_cases',
        'blessings',
        'announcements',
        'tasks',
      ],
    )
    assert.equal(isCustomFormModule('visitors'), true)
    assert.equal(isCustomFormModule('events'), false)
    assert.equal(validateCustomFormFields('events', [], VISITOR_LIVE).length > 0, true)
  })

  it('refuses unknown columns, the id column, and empty forms', () => {
    assert.match(
      validateCustomFormFields(
        'visitors',
        [
          {
            key: 'nope',
            label: 'Nope',
            type: 'string',
            required: false,
          },
        ],
        VISITOR_LIVE,
      ).join(' '),
      /Unknown column "nope"/,
    )
    assert.match(
      validateCustomFormFields(
        'visitors',
        [{ key: 'id', label: 'Id', type: 'string', required: false }],
        VISITOR_LIVE,
      ).join(' '),
      /stamped by the portal/,
    )
    assert.match(
      validateCustomFormFields('visitors', [], VISITOR_LIVE).join(' '),
      /at least one field/,
    )
  })

  it('covers every NOT NULL-no-default column with a required field', () => {
    const missing = validateCustomFormFields(
      'visitors',
      [
        {
          key: 'email',
          label: 'Email',
          type: 'string',
          required: false,
        },
      ],
      VISITOR_LIVE,
    )
    assert.match(
      missing.join(' '),
      /visitor_first_name.*cannot be left blank/,
      'the uncovered database column is named',
    )
    const covered = validateCustomFormFields(
      'visitors',
      [
        {
          key: 'visitor_first_name',
          label: 'First name',
          type: 'string',
          required: true,
        },
        {
          key: 'visit_date',
          label: 'Visit date',
          type: 'date',
          required: true,
        },
      ],
      VISITOR_LIVE,
    )
    assert.deepEqual(covered, [])
  })

  it('selects carry two or more unique choices; other kinds carry none', () => {
    const bare = validateCustomFormFields(
      'people',
      [{ key: 'notes', label: 'Notes', type: 'select', required: false }],
      [{ name: 'notes', nullable: true, hasDefault: false }],
    )
    assert.match(bare.join(' '), /needs between 2 and 30 choices/)
    const stray = validateCustomFormFields(
      'people',
      [
        {
          key: 'notes',
          label: 'Notes',
          type: 'text',
          required: false,
          options: ['a'],
        },
      ],
      [{ name: 'notes', nullable: true, hasDefault: false }],
    )
    assert.match(stray.join(' '), /Only a select carries choices/)
  })
})

describe('AFC-897 submission rules', () => {
  const FIELDS = [
    { key: 'visitor_first_name', label: 'First name', type: 'string', required: true },
    { key: 'email', label: 'Email', type: 'string', required: false },
    { key: 'party', label: 'Party', type: 'integer', required: false },
    {
      key: 'age_group',
      label: 'Age group',
      type: 'select',
      required: false,
      options: ['adult', 'child'],
    },
  ]

  it('fills pass when required fields hold and kinds match', () => {
    assert.deepEqual(
      validateSubmissionValues(FIELDS, {
        visitor_first_name: 'Adaeze',
        party: 3,
        age_group: 'adult',
      }),
      [],
    )
  })

  it('refuses missing required fields, unknown keys and kind mismatches', () => {
    assert.match(
      validateSubmissionValues(FIELDS, { email: 'a@b.c' }).join(' '),
      /First name.*required/,
    )
    assert.match(
      validateSubmissionValues(FIELDS, {
        visitor_first_name: 'Adaeze',
        nope: 1,
      }).join(' '),
      /not a field of this form/,
    )
    assert.match(
      validateSubmissionValues(FIELDS, {
        visitor_first_name: 'Adaeze',
        party: 'three',
      }).join(' '),
      /whole number/,
    )
    assert.match(
      validateSubmissionValues(FIELDS, {
        visitor_first_name: 'Adaeze',
        age_group: 'elder',
      }).join(' '),
      /not one of the choices/,
    )
  })
})

describe('AFC-897 form routes', () => {
  it('the register lists behind the custom forms read grant', () => {
    const src = codeOf('apps/web/server/api/custom-forms/index.get.ts')
    assert.match(src, /requireCan\(scope, 'custom_forms', 'read'\)/)
    assert.match(src, /_eq: module/)
  })

  it('the picker proxies live Directus introspection with no generic proxy', () => {
    const util = codeOf('apps/web/server/utils/custom-forms.ts')
    assert.match(util, /\/fields\//)
    assert.match(util, /is_nullable !== false/)
    assert.match(util, /default_value !== null/)
    assert.match(util, /DRAWABLE_DIRECTUS_TYPES/)
    const route = codeOf('apps/web/server/api/custom-forms/fields.get.ts')
    assert.match(route, /requireCan\(scope, 'custom_forms', 'read'\)/)
    assert.match(route, /readModuleColumns/)
  })

  it('creating is area-only and re-checks keys and coverage live', () => {
    const src = codeOf('apps/web/server/api/custom-forms/index.post.ts')
    assert.match(src, /requireArea\(event\)/)
    assert.match(src, /readModuleColumns/)
    assert.match(src, /validateCustomFormFields\(/)
    assert.match(src, /invalid_definition/)
    assert.match(src, /duplicate_form/)
  })

  it('definitions delete but never silently rewrite in phase 1', () => {
    const src = codeOf('apps/web/server/api/custom-forms/[id].delete.ts')
    assert.match(src, /requireArea\(event\)/)
    assert.match(src, /deleteItem\(event, scope, 'custom_forms', id\)/)
  })

  it('fills hold create on the linked module, re-check columns, and stamp scope branch', () => {
    const src = codeOf('apps/web/server/api/custom-forms/[id]/submissions.post.ts')
    assert.match(src, /requireCan\(scope, module, 'create'\)/)
    assert.match(src, /validateSubmissionValues\(/)
    assert.match(src, /stale_definition/)
    assert.match(src, /resolveBranch\(scope, null\)/)
    assert.match(src, /module_refused/)
  })
})

describe('AFC-897 app wiring', () => {
  it('the vocabulary, matrix and types know the register', () => {
    assert.match(
      codeOf('packages/shared/src/collections.ts'),
      /customForms: 'custom_forms'/,
    )
    const matrix = codeOf('packages/shared/src/role-matrix.ts')
    assert.match(matrix, /\[COLLECTIONS\.customForms\]/)
    assert.match(matrix, /branch_admin: \[R, 'all'\]/)
    assert.match(codeOf('apps/web/types/portal.ts'), /interface CustomFormRow/)
  })

  it('the hub links entries to the new form, and lists the custom register', () => {
    const src = codeOf('apps/web/pages/forms.vue')
    for (const to of [
      '/visitors?new=1',
      '/people?new=1',
      '/households?new=1',
      '/marriage?new=1',
      '/welfare?new=1',
      '/blessings?new=1',
      '/announcements?new=1',
      '/tasks?new=1',
    ]) {
      assert.ok(src.includes(`to: '${to}'`), `${to} opens the create form`)
    }
    assert.ok(src.includes("to: '/register'"), 'the public form links bare')
    assert.ok(src.includes("to: '/custom-forms'"), 'the custom register is listed')
    assert.match(src, /COLLECTIONS\.customForms/)
  })

  it('every linked page opens its create affordance on ?new=1', () => {
    for (const page of [
      'visitors',
      'people',
      'households',
      'welfare',
      'blessings',
      'announcements',
      'tasks',
    ]) {
      const src = codeOf(`apps/web/pages/${page}/index.vue`)
      assert.match(src, /route\.query\.new !== undefined/, `${page} honours ?new=1`)
      assert.match(src, /showForm\.value = true/, `${page} opens its form`)
    }
    const marriage = codeOf('apps/web/pages/marriage/index.vue')
    assert.match(marriage, /route\.query\.new !== undefined/)
    assert.match(marriage, /matterShowForm\.value = true/)
  })

  it('every v1 module page mounts the renderer for its own module', () => {
    const mounts = {
      visitors: 'visitors',
      people: 'people',
      households: 'households',
      welfare: 'welfare_cases',
      blessings: 'blessings',
      announcements: 'announcements',
      tasks: 'tasks',
    }
    for (const [page, module] of Object.entries(mounts)) {
      assert.match(
        codeOf(`apps/web/pages/${page}/index.vue`),
        new RegExp(`<CustomFormRenderer module="${module}"`),
        `${page} renders ${module} forms`,
      )
    }
  })

  it('the builder reads live fields and the renderer fills through submissions', () => {
    const builder = codeOf('apps/web/components/CustomFormBuilder.vue')
    assert.match(builder, /\/api\/custom-forms\/fields/)
    assert.match(builder, /Required by the database/)
    const renderer = codeOf('apps/web/components/CustomFormRenderer.vue')
    assert.match(renderer, /\/api\/custom-forms/)
    assert.match(renderer, /\/submissions/)
    const register = codeOf('apps/web/pages/custom-forms.vue')
    assert.match(register, /New custom form/)
    assert.match(register, /api\.remove/)
  })
})
