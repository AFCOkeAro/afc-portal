<script setup lang="ts">
import { MARRIAGE_FORM_KEYS } from '@afc/shared'

const props = defineProps<{ caseId: string; caseStage: string }>()

const emit = defineEmits<{ refreshed: [] }>()

const api = useApi()

type FieldType = 'text' | 'date' | 'textarea' | 'switch' | 'select' | 'answers' | 'lines' | 'numbers'
interface FieldDef {
  name: string
  label: string
  type: FieldType
  options?: string[]
  count?: number
  hint?: string
}

const KEY_LABELS: Record<string, string> = {
  proposal_male: 'Proposal record (brother)',
  proposal_female: 'Proposal record (sister)',
  form_a: 'Form A',
  premarital_q1: 'Pre-marital questionnaire 1',
  premarital_q2: 'Pre-marital questionnaire 2',
  engagement_list: 'Family introduction + bridal list',
  form_c_guideline: 'LGA / FG Form C guideline',
  wedding_programme: 'Engagement programme schedule',
  wedding_info: 'Wedding information form',
  music_selection: 'Music selection',
  requirements_dressing: 'Requirements + dressing pledge',
  engagement_procedures: 'Engagement ceremony procedures',
  counselling_curriculum: 'Counselling curriculum + checklist',
  documentation_checklist: 'Documentation checklist',
  couple_orientation: 'Couple orientation',
  vows: 'Wedding vows wording',
}

/** Essential fields per key (transcription document holds the full field lists). */
const FIELD_DEFS: Record<string, FieldDef[]> = {
  proposal_male: [
    { name: 'applicant_name', label: 'Applicant name', type: 'text' },
    { name: 'branch', label: 'Branch', type: 'text' },
    { name: 'area', label: 'Area', type: 'text' },
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'profession', label: 'Profession', type: 'text' },
    { name: 'workplace', label: 'Place of work', type: 'text' },
    { name: 'salary', label: 'Monthly salary / income', type: 'text' },
    { name: 'qualification', label: 'Qualification', type: 'text' },
    { name: 'health', label: 'Health condition', type: 'textarea' },
    { name: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
  proposal_female: [
    { name: 'full_name', label: 'Full name', type: 'text' },
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'hometown', label: 'Home town', type: 'text' },
    { name: 'lga', label: 'LGA', type: 'text' },
    { name: 'state', label: 'State', type: 'text' },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'email', label: 'Email', type: 'text' },
    { name: 'health', label: 'Health condition', type: 'textarea' },
    { name: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
  form_a: [
    { name: 'surname', label: 'Surname', type: 'text' },
    { name: 'first_name', label: 'First name', type: 'text' },
    { name: 'other_name', label: 'Other name', type: 'text' },
    { name: 'sex', label: 'Sex', type: 'select', options: ['male', 'female'] },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'status', label: 'Status', type: 'select', options: ['single', 'married', 'widow', 'widower', 'divorcee', 'single_parent'] },
    { name: 'profession', label: 'Profession', type: 'text' },
    { name: 'workplace', label: 'Place of work', type: 'text' },
    { name: 'church_work', label: 'Work in the church', type: 'textarea' },
    { name: 'conviction', label: 'Conviction (3 sentences)', type: 'textarea' },
  ],
  premarital_q1: [
    { name: 'participant_name', label: 'Participant name', type: 'text' },
    { name: 'spouse_name', label: 'Intended spouse name', type: 'text' },
    { name: 'role', label: 'Role', type: 'select', options: ['brother', 'sister'] },
    { name: 'answers', label: 'Answers Q1–Q13', type: 'answers', count: 13 },
  ],
  premarital_q2: [
    { name: 'participant_name', label: 'Participant name', type: 'text' },
    { name: 'spouse_name', label: 'Intended spouse name', type: 'text' },
    { name: 'role', label: 'Role', type: 'select', options: ['brother', 'sister'] },
    { name: 'answers', label: 'Answers Q1–Q13', type: 'answers', count: 13 },
  ],
  engagement_list: [
    { name: 'from_family', label: 'From the family of', type: 'text' },
    { name: 'to_family', label: 'To the family of', type: 'text' },
    { name: 'spiritual_items', label: 'Spiritual items', type: 'textarea' },
    { name: 'dowry', label: 'Dowry (₦)', type: 'text' },
    { name: 'food_items', label: 'Food items', type: 'textarea' },
    { name: 'bridal_items', label: 'Bridal items', type: 'textarea' },
  ],
  form_c_guideline: [
    { name: 'acknowledged', label: 'Guideline read and understood', type: 'switch' },
    { name: 'registry', label: 'Registry', type: 'text' },
    { name: 'place_of_worship', label: 'Place of worship', type: 'text' },
    { name: 'application_ref', label: 'Application reference', type: 'text' },
  ],
  wedding_programme: [
    { name: 'venue', label: 'Venue', type: 'text' },
    { name: 'wedding_date', label: 'Date', type: 'date' },
    { name: 'congregational_song_1', label: 'Congregational song 1', type: 'text' },
    { name: 'choir_piece', label: 'Choir', type: 'text' },
    { name: 'quartet_piece', label: 'Quartet', type: 'text' },
    { name: 'solo_piece', label: 'Solo', type: 'text' },
    { name: 'congregational_song_2', label: 'Congregational song 2', type: 'text' },
    { name: 'organist', label: 'Assigned organist', type: 'text' },
    { name: 'prepared_by', label: 'Prepared by', type: 'text' },
    { name: 'approved_by', label: 'Approved by', type: 'text' },
  ],
  wedding_info: [
    { name: 'place_of_wedding', label: 'Place of wedding', type: 'text' },
    { name: 'marriage_registry', label: 'Marriage registry', type: 'text' },
    { name: 'wedding_date', label: 'Wedding date', type: 'date' },
    { name: 'wedding_time', label: 'Time', type: 'text' },
    { name: 'officiating_minister', label: 'Officiating minister', type: 'text' },
    { name: 'brother.surname', label: 'Brother surname', type: 'text' },
    { name: 'brother.other_names', label: 'Brother other names', type: 'text' },
    { name: 'brother.date_of_birth', label: 'Brother date of birth', type: 'date' },
    { name: 'sister.surname', label: 'Sister surname', type: 'text' },
    { name: 'sister.other_names', label: 'Sister other names', type: 'text' },
    { name: 'sister.date_of_birth', label: 'Sister date of birth', type: 'date' },
    { name: 'verified', label: 'Verified — names match the people records', type: 'switch' },
  ],
  music_selection: [
    { name: 'congregational_song_1', label: 'Congregational song 1', type: 'text' },
    { name: 'congregational_song_2', label: 'Congregational song 2', type: 'text' },
    { name: 'choir_piece', label: 'Choir', type: 'text' },
    { name: 'quartet_piece', label: 'Quartet', type: 'text' },
    { name: 'solo_piece', label: 'Solo', type: 'text' },
    { name: 'organist', label: 'Organist', type: 'text' },
    { name: 'music_director', label: 'Music director', type: 'text' },
    { name: 'approved', label: 'Approved by music director', type: 'switch' },
  ],
  requirements_dressing: [
    { name: 'brother_signature', label: 'Brother signature (name)', type: 'text' },
    { name: 'sister_signature', label: 'Sister signature (name)', type: 'text' },
    { name: 'pledge_date', label: 'Pledge date', type: 'date' },
    { name: 'approved_by', label: 'Approved by (FDD / counsellor / overseer)', type: 'text' },
  ],
  engagement_procedures: [
    { name: 'completed_steps', label: 'Completed steps (1–10)', type: 'numbers', count: 10 },
    { name: 'master_of_ceremonies', label: 'Master of ceremonies (one M.C.)', type: 'text' },
    { name: 'conducted_date', label: 'Conducted date', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  counselling_curriculum: [
    { name: 'completed_weeks', label: 'Completed weeks (1–12)', type: 'numbers', count: 12 },
    { name: 'exercise_books_verified', label: 'Exercise books verified', type: 'switch' },
    { name: 'recommendation', label: 'Counsellor recommendation', type: 'select', options: ['ready', 'continue', 'delay'] },
    { name: 'counsellor', label: 'Counsellor', type: 'text' },
  ],
  documentation_checklist: [
    { name: 'pre_counselling', label: 'Pre-counselling rows (one per line)', type: 'lines' },
    { name: 'pre_wedding', label: 'Pre-wedding rows (one per line)', type: 'lines' },
    { name: 'back_office', label: 'Back-office rows (one per line)', type: 'lines' },
    { name: 'verified_by', label: 'Verified by', type: 'text' },
  ],
  couple_orientation: [
    { name: 'received', label: 'Orientation received', type: 'switch' },
    { name: 'received_date', label: 'Received date', type: 'date' },
  ],
  vows: [
    { name: 'vow_type', label: 'Vow wording', type: 'select', options: ['A', 'B'] },
    { name: 'brother_full_name', label: 'Brother full name', type: 'text' },
    { name: 'sister_full_name', label: 'Sister full name', type: 'text' },
    { name: 'giver_name', label: 'Giver (ceremony B)', type: 'text' },
  ],
}

const formKey = ref<string>('proposal_male')
const values = ref<Record<string, unknown>>({})
const forms = ref<Record<string, Record<string, unknown> | null>>({})
const formsError = ref('')
const saveError = ref('')
const savedNote = ref('')
const prefillNote = ref('')

function blankFor(defs: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of defs) {
    if (def.type === 'switch') setInto(out, def.name, false)
    else if (def.type === 'answers') setInto(out, def.name, Array.from({ length: def.count ?? 0 }, () => ''))
    else if (def.type === 'numbers') setInto(out, def.name, [])
    else setInto(out, def.name, '')
  }
  if (formKey.value === 'engagement_list') out.spiritual_items = '1 White Holy Bible (KJV)'
  if (formKey.value === 'vows') out.vow_type = 'B'
  return out
}

function getPath(name: string): unknown {
  return name.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, values.value)
}

function setPath(name: string, value: unknown) {
  const parts = name.split('.')
  let target = values.value
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (target[part] === null || typeof target[part] !== 'object') target[part] = {}
    target = target[part] as Record<string, unknown>
  }
  target[parts[parts.length - 1]] = value
}

function selectForm(key: string) {
  formKey.value = key
  saveError.value = ''
  savedNote.value = ''
  prefillNote.value = ''
  const latest = forms.value[key]?.payload as Record<string, unknown> | undefined
  const next = blankFor(FIELD_DEFS[key] ?? [])
  if (latest) {
    for (const def of FIELD_DEFS[key] ?? []) {
      const hit = def.name.includes('.')
        ? getNested(latest, def.name)
        : latest[def.name]
      if (hit !== undefined) setInto(next, def.name, hit)
    }
  }
  values.value = next
}

function getNested(source: Record<string, unknown>, name: string): unknown {
  return name.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, source)
}

function setInto(target: Record<string, unknown>, name: string, value: unknown) {
  const parts = name.split('.')
  let node = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index] as string
    if (node[part] === null || typeof node[part] !== 'object') node[part] = {}
    node = node[part] as Record<string, unknown>
  }
  node[parts[parts.length - 1] as string] = value
}

function toPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const def of FIELD_DEFS[formKey.value] ?? []) {
    const raw = getPath(def.name)
    if (def.type === 'lines' && typeof raw === 'string') {
      setInto(payload, def.name, raw.split('\n').map((line) => line.trim()).filter(Boolean))
    } else {
      setInto(payload, def.name, raw)
    }
  }
  return payload
}

function fromStored(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).join('\n')
  return String(value ?? '')
}

async function loadForms() {
  formsError.value = ''
  try {
    const response = await api.get<{ data: Record<string, Record<string, unknown> | null> }>(
      `/api/marriage-cases/${props.caseId}/forms`,
    )
    forms.value = response.data
    selectForm(formKey.value)
  } catch (cause) {
    formsError.value = (cause as { message?: string }).message ?? 'Could not load the forms'
  }
}

async function save() {
  saveError.value = ''
  savedNote.value = ''
  try {
    await api.post(`/api/marriage-cases/${props.caseId}/forms`, {
      form_key: formKey.value,
      stage: props.caseStage,
      payload: toPayload(),
    })
    savedNote.value = 'Saved. A correction saves as a new row; the latest row wins.'
    await loadForms()
    emit('refreshed')
  } catch (cause) {
    saveError.value = (cause as { message?: string }).message ?? 'Could not save this form'
  }
}

async function prefillWeddingInfo() {
  prefillNote.value = ''
  try {
    const response = await api.get<{
      data: {
        brother: Record<string, unknown> | null
        sister: Record<string, unknown> | null
      }
    }>(`/api/marriage-cases/${props.caseId}/wedding-info`)
    const next = values.value
    for (const side of ['brother', 'sister'] as const) {
      const person = response.data[side]
      if (!person) continue
      setPath(`${side}.surname`, person.surname ?? '')
      setPath(`${side}.other_names`, person.other_names ?? '')
      setPath(`${side}.date_of_birth`, person.date_of_birth ?? '')
    }
    values.value = { ...next }
    prefillNote.value = 'Filled from the people records. Check every field, then tick verified.'
  } catch (cause) {
    prefillNote.value = (cause as { message?: string }).message ?? 'Prefill did not go through'
  }
}

function toggleNumber(name: string, step: number) {
  const current = new Set(getPath(name) as number[] ?? [])
  if (current.has(step)) current.delete(step)
  else current.add(step)
  setPath(name, [...current].sort((a, b) => a - b))
  values.value = { ...values.value }
}

await loadForms()
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Stage forms</h2>
    </template>
    <UAlert
      v-if="formsError"
      color="error"
      variant="subtle"
      title="Could not load the forms"
      :description="formsError"
    />
    <div v-else class="grid gap-4">
      <UFormField label="Form">
        <USelect
          :model-value="formKey"
          :items="MARRIAGE_FORM_KEYS.map((key: string) => ({ label: `${KEY_LABELS[key]}${forms[key] ? ' ✓' : ''}`, value: key }))"
          class="w-full"
          @update:model-value="selectForm(String($event))"
        />
      </UFormField>

      <div v-if="formKey === 'wedding_info'" class="flex justify-end">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          label="Fill from people records"
          icon="i-lucide-sparkles"
          @click="prefillWeddingInfo"
        />
      </div>
      <p v-if="prefillNote" class="text-sm text-gray-500">{{ prefillNote }}</p>

      <div v-for="def in FIELD_DEFS[formKey]" :key="def.name" class="grid gap-1">
        <UFormField :label="def.label" :hint="def.hint">
          <UInput
            v-if="def.type === 'text' || def.type === 'date'"
            :model-value="String(getPath(def.name) ?? '')"
            :type="def.type === 'date' ? 'date' : 'text'"
            class="w-full"
            @update:model-value="setPath(def.name, $event); values = { ...values }"
          />
          <UTextarea
            v-else-if="def.type === 'textarea'"
            :model-value="String(getPath(def.name) ?? '')"
            class="w-full"
            @update:model-value="setPath(def.name, $event); values = { ...values }"
          />
          <USwitch
            v-else-if="def.type === 'switch'"
            :model-value="Boolean(getPath(def.name))"
            @update:model-value="setPath(def.name, $event); values = { ...values }"
          />
          <USelect
            v-else-if="def.type === 'select'"
            :model-value="String(getPath(def.name) ?? '')"
            :items="(def.options ?? []).map((option: string) => ({ label: option, value: option }))"
            class="w-full"
            @update:model-value="setPath(def.name, $event); values = { ...values }"
          />
          <div v-else-if="def.type === 'answers'" class="grid gap-2">
            <UTextarea
              v-for="index in (def.count ?? 0)"
              :key="index"
              :model-value="String((getPath(def.name) as string[] ?? [])[index - 1] ?? '')"
              :placeholder="`Answer ${index}`"
              class="w-full"
              @update:model-value="(getPath(def.name) as string[])[index - 1] = String($event); values = { ...values }"
            />
          </div>
          <UTextarea
            v-else-if="def.type === 'lines'"
            :model-value="fromStored(getPath(def.name))"
            placeholder="One item per line"
            class="w-full"
            @update:model-value="setPath(def.name, $event); values = { ...values }"
          />
          <div v-else-if="def.type === 'numbers'" class="flex flex-wrap gap-2">
            <UButton
              v-for="step in (def.count ?? 0)"
              :key="step"
              size="xs"
              :color="(getPath(def.name) as number[] ?? []).includes(step) ? 'primary' : 'neutral'"
              :variant="(getPath(def.name) as number[] ?? []).includes(step) ? 'solid' : 'outline'"
              :label="String(step)"
              @click="toggleNumber(def.name, step)"
            />
          </div>
        </UFormField>
      </div>

      <UAlert v-if="saveError" color="error" variant="subtle" :title="saveError" />
      <UAlert v-if="savedNote" color="success" variant="subtle" :title="savedNote" />
      <div class="flex justify-end">
        <UButton label="Save form" icon="i-lucide-check" @click="save" />
      </div>
    </div>
  </UCard>
</template>
