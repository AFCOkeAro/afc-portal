/**
 * Marriage phase-B form schemas (AFC-677).
 *
 * Field-for-field from the 16 source files transcribed on the AFC-677
 * document `marriage-transcription` (read via /api/attachments on AFC-460,
 * never inferred). Brother/sister language in every label, message and type
 * name -- the portal never names a groom or a bride.
 *
 * Smallest-defensible strictness (stated): identifiers that route the case
 * (names, branch, dates, signatures, the pledge) are required; long pastoral
 * answers are optional text. The source paper forms demand ink in every box,
 * but the portal accepts staged saves -- a counsellor reviews completeness
 * at the stage gate, the schema does not brick a half-filled form. The
 * wedding-info verify checkbox is the exception: the route only flips
 * `wedding_info_verified` when `verified` arrives true.
 *
 * Payloads land in `marriage_case_forms.payload` (JSONB, migration 0036);
 * the DB owns the closed key vocabulary, these schemas own the shapes.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText } from './common'

/** The 16 transcribed source forms, in transcription-document order. */
export const MARRIAGE_FORM_KEYS = [
  'proposal_male',
  'proposal_female',
  'form_a',
  'premarital_q1',
  'premarital_q2',
  'engagement_list',
  'form_c_guideline',
  'wedding_programme',
  'wedding_info',
  'music_selection',
  'requirements_dressing',
  'engagement_procedures',
  'counselling_curriculum',
  'documentation_checklist',
  'couple_orientation',
  'vows',
] as const
export type MarriageFormKey = (typeof MARRIAGE_FORM_KEYS)[number]

const requiredName = (label: string) => z.string().trim().min(1, label).max(200)

const yesNo = z.enum(['yes', 'no'])

const thirteenAnswers = () => z.array(z.string().trim().max(4000)).max(13).default([])

/** F1. Proposal Record (brother). */
export const proposalMaleSchema = z.object({
  branch: requiredName('Choose the branch'),
  area: optionalText(120),
  applicant_name: requiredName('Enter the applicant name'),
  address: optionalText(400),
  date_of_birth: dateSchema.optional(),
  phone: requiredName('Enter the phone number'),
  profession: optionalText(200),
  workplace: optionalText(200),
  salary: optionalText(120),
  qualification: optionalText(200),
  gospel_date: optionalText(120),
  christian_experiences: optionalNote(),
  church_work: optionalText(400),
  health: optionalText(400),
  remarks: optionalNote(),
})

/** F2. Proposal Record (sister). */
export const proposalFemaleSchema = z.object({
  full_name: requiredName('Enter the full name'),
  address: optionalText(400),
  hometown: optionalText(120),
  lga: optionalText(120),
  state: optionalText(120),
  date_of_birth: dateSchema.optional(),
  status: optionalText(60),
  phone: optionalText(60),
  email: optionalText(200),
  salary: optionalText(120),
  qualification: optionalText(200),
  gospel_date: optionalText(120),
  christian_experiences: optionalNote(),
  church_work: optionalText(400),
  health: optionalText(400),
  remarks: optionalNote(),
  general_remarks: optionalNote(),
  engagement_date: dateSchema.optional(),
  wedding_date: dateSchema.optional(),
  officiating_minister: optionalText(200),
})

/** F3. Form A. */
export const formASchema = z.object({
  surname: requiredName('Enter the surname'),
  first_name: requiredName('Enter the first name'),
  other_name: optionalText(200),
  date_of_birth: dateSchema.optional(),
  age: z.coerce.number().int().min(18).max(120).optional(),
  sex: z.enum(['male', 'female']),
  ethnic_group: optionalText(120),
  hometown: optionalText(120),
  lga: optionalText(120),
  state: optionalText(120),
  phone: requiredName('Enter the phone number'),
  email: optionalText(200),
  status: z
    .enum(['single', 'married', 'widow', 'widower', 'divorcee', 'single_parent'])
    .default('single'),
  profession: optionalText(200),
  workplace: optionalText(200),
  position: optionalText(200),
  salary: optionalText(120),
  date_saved: optionalText(120),
  date_sanctified: optionalText(120),
  date_baptized: optionalText(120),
  church_work: optionalText(400),
  date_appointed: optionalText(120),
  ailments: optionalNote(),
  reproductive_affected: yesNo.optional(),
  told_sister: yesNo.optional(),
  sister_response: optionalNote(),
  how_sister_knew_church: optionalNote(),
  intended_date: optionalText(120),
  sister_particulars: optionalNote(),
  past_relationship: optionalNote(),
  wedding_cost: optionalText(120),
  housekeeping: optionalText(120),
  account_balance: optionalText(120),
  statement_6m: yesNo.optional(),
  amount_owing: optionalText(120),
  repayment_mode: optionalText(200),
  accommodation: optionalNote(),
  furniture: optionalNote(),
  conviction: optionalNote(),
  carnal_knowledge: optionalText(400),
  prior_child: optionalNote(),
  inlaw_influence: optionalNote(),
  prevent_control: optionalNote(),
  care_parents: optionalNote(),
  housemaids: optionalNote(),
  doctrines: optionalNote(),
  teamwork: optionalNote(),
  till_death: optionalNote(),
  love_feelings: optionalNote(),
})

/** F4/F5. Pre-marital questionnaires (13 answers each, independent). */
export const premaritalQSchema = z.object({
  participant_name: requiredName('Enter the participant name'),
  spouse_name: requiredName('Enter the intended spouse name'),
  role: z.enum(['brother', 'sister']),
  answers: thirteenAnswers(),
})
export const premaritalQ1Schema = premaritalQSchema
export const premaritalQ2Schema = premaritalQSchema

/** F6. Engagement / bridal list (3 sections). */
export const engagementListSchema = z.object({
  from_family: requiredName('Name the family presenting the list'),
  to_family: requiredName('Name the family receiving the list'),
  spiritual_items: z.string().trim().max(2000).default('1 White Holy Bible (KJV)'),
  dowry: optionalText(120),
  food_items: optionalText(2000),
  bridal_items: optionalText(2000),
  received_by: optionalText(200),
  received_date: dateSchema.optional(),
})

/** F7. LGA/FG Form C guideline acknowledgement. */
export const formCGuidelineSchema = z.object({
  acknowledged: z
    .boolean()
    .refine((v) => v === true, 'Confirm the guideline has been read'),
  registry: optionalText(200),
  place_of_worship: optionalText(200),
  application_ref: optionalText(120),
})

/** F8. Wedding programme (order of service + sign-off). */
export const weddingProgrammeSchema = z.object({
  venue: optionalText(200),
  wedding_date: dateSchema.optional(),
  congregational_song_1: optionalText(200),
  choir_piece: optionalText(200),
  quartet_piece: optionalText(200),
  solo_piece: optionalText(200),
  congregational_song_2: optionalText(200),
  organist: optionalText(200),
  contact_phone: optionalText(60),
  office_duty: optionalText(200),
  remarks: optionalNote(),
  prepared_by: optionalText(200),
  checked_by: optionalText(200),
  approved_by: optionalText(200),
})

const weddingPartySchema = z.object({
  surname: requiredName('Enter the surname'),
  other_names: requiredName('Enter the other names'),
  date_of_birth: dateSchema.optional(),
  occupation: optionalText(200),
  residence: optionalText(400),
  phone: optionalText(60),
  father_name: optionalText(200),
  father_occupation: optionalText(200),
  witness: optionalText(200),
})

/** F9. Wedding Information Form (certificate source; prefilled, verified). */
export const weddingInfoSchema = z.object({
  place_of_wedding: requiredName('Enter the place of wedding'),
  marriage_registry: optionalText(200),
  wedding_date: dateSchema,
  wedding_time: optionalText(20),
  officiating_minister: optionalText(200),
  brother: weddingPartySchema.extend({
    condition: z.enum(['bachelor', 'widower']).default('bachelor'),
  }),
  sister: weddingPartySchema.extend({
    condition: z.enum(['spinster', 'widow']).default('spinster'),
  }),
  /** Explicit verify checkbox: only true flips wedding_info_verified. */
  verified: z.boolean().default(false),
})

/** F10. Music selection (derived from programme slots + checklist row). */
export const musicSelectionSchema = z.object({
  congregational_song_1: optionalText(200),
  congregational_song_2: optionalText(200),
  choir_piece: optionalText(200),
  quartet_piece: optionalText(200),
  solo_piece: optionalText(200),
  bridal_march: optionalText(200),
  wedding_march: optionalText(200),
  organist: optionalText(200),
  approved: z.boolean().default(false),
  music_director: optionalText(200),
})

/** F11/F12. Requirements & dressing pledge of compliance. */
export const requirementsDressingSchema = z.object({
  brother_signature: requiredName('The brother signs the pledge'),
  sister_signature: requiredName('The sister signs the pledge'),
  pledge_date: dateSchema.optional(),
  approved_by: optionalText(200),
  approval_date: dateSchema.optional(),
})

/** F13. Engagement ceremony procedures (10-step programme). */
export const engagementProceduresSchema = z.object({
  completed_steps: z.array(z.number().int().min(1).max(10)).default([]),
  master_of_ceremonies: optionalText(200),
  conducted_date: dateSchema.optional(),
  notes: optionalNote(),
})

/** F14. Counselling curriculum progress + readiness snapshot. */
export const counsellingCurriculumSchema = z.object({
  completed_weeks: z.array(z.number().int().min(1).max(12)).default([]),
  exercise_books_verified: z.boolean().default(false),
  readiness_scores: z.record(z.number().int().min(1).max(5)).default({}),
  recommendation: z.enum(['ready', 'continue', 'delay']).optional(),
  counsellor: optionalText(200),
})

/** F15. Documentation checklist (3 tables of ticked rows). */
export const documentationChecklistSchema = z.object({
  pre_counselling: z.array(z.string().trim().max(200)).default([]),
  pre_wedding: z.array(z.string().trim().max(200)).default([]),
  back_office: z.array(z.string().trim().max(200)).default([]),
  verified_by: optionalText(200),
})

/** F16. Couple orientation received. */
export const coupleOrientationSchema = z.object({
  received: z.boolean().default(false),
  received_date: dateSchema.optional(),
})

/** F17. Vow wording selection. A = Ceremony One, B = Ceremony Two (default B). */
export const MARRIAGE_VOW_TYPES = ['A', 'B'] as const
export type MarriageVowType = (typeof MARRIAGE_VOW_TYPES)[number]

export const vowsSchema = z.object({
  vow_type: z.enum(MARRIAGE_VOW_TYPES).default('B'),
  brother_full_name: requiredName('Enter the brother full name'),
  sister_full_name: requiredName('Enter the sister full name'),
  giver_name: optionalText(200),
  ceremony_date: dateSchema.optional(),
  venue: optionalText(200),
})

export const marriageFormPayloadSchemas = {
  proposal_male: proposalMaleSchema,
  proposal_female: proposalFemaleSchema,
  form_a: formASchema,
  premarital_q1: premaritalQ1Schema,
  premarital_q2: premaritalQ2Schema,
  engagement_list: engagementListSchema,
  form_c_guideline: formCGuidelineSchema,
  wedding_programme: weddingProgrammeSchema,
  wedding_info: weddingInfoSchema,
  music_selection: musicSelectionSchema,
  requirements_dressing: requirementsDressingSchema,
  engagement_procedures: engagementProceduresSchema,
  counselling_curriculum: counsellingCurriculumSchema,
  documentation_checklist: documentationChecklistSchema,
  couple_orientation: coupleOrientationSchema,
  vows: vowsSchema,
} as const satisfies Record<MarriageFormKey, z.ZodTypeAny>

/** Submit wrapper: key selects the payload schema; the route validates. */
export const marriageFormSubmitSchema = z.object({
  form_key: z.enum(MARRIAGE_FORM_KEYS),
  stage: optionalText(60),
  payload: z.record(z.unknown()).default({}),
})
export type MarriageFormSubmit = z.infer<typeof marriageFormSubmitSchema>

/**
 * Vow generator (F17). Inserts both names into the fixed Minister's Manual
 * wording; type selector A/B, default B. Portal renders brother/sister.
 */
export function buildVowText(
  vowType: MarriageVowType,
  brotherFullName: string,
  sisterFullName: string,
  giverName?: string,
): string {
  const brother = brotherFullName.trim()
  const sister = sisterFullName.trim()
  const intro =
    'We are gathered here to join this couple in holy matrimony. Since we know ' +
    'that Almighty God is the author of the institution of marriage -- that by His ' +
    'word this holy relationship between man and wife was brought into existence -- ' +
    'we do not hesitate to proceed according to the instructions given us in His ' +
    'Holy Bible and in accordance with the laws of our civil state.'
  const brotherVow =
    `${brother}, do you take this woman, whose right hand you now hold, to be ` +
    'your lawfully wedded wife; and solemnly promise, God helping you, that you will ' +
    'be a true and devoted husband to her, that you will love, honor, cherish, and ' +
    'protect her, in sickness and in health, in sorrow and in joy, in adversity and ' +
    'in prosperity; and that you will keep yourself to her, and to her alone, until ' +
    'God by death shall separate you? The brother answers: "I do."'
  const sisterVow =
    `${sister}, do you take this man whose right hand you now hold, to be your ` +
    'lawfully wedded husband; and solemnly promise, God helping you, that you will ' +
    'be a true and devoted wife to him, that you will love, honor, cherish, and ' +
    'comfort him, in sickness and in health, in sorrow and in joy, in adversity and ' +
    'in prosperity; and that you will keep yourself to him, and to him alone, until ' +
    'God by death shall separate you? The sister answers: "I do."'
  const pronouncement =
    `Inasmuch, then, as ${brother} and ${sister} have both signified their desire ` +
    'to be joined together in the holy bond of matrimony, have borne witness of this ' +
    'fact before God and this company, and have pledged their fidelity and love each ' +
    'to the other, I, by the virtue of the authority vested in me as a minister of ' +
    'the Gospel of Jesus Christ, and by the laws of the Federal Republic of Nigeria ' +
    'now pronounce them husband and wife, in the name of the Father, and of the Son, ' +
    'and of the Holy Ghost. "What therefore God hath joined together, let not man ' +
    'put asunder."'
  if (vowType === 'A') {
    return [
      'MARRIAGE CEREMONY ONE (the sister is not given away).',
      intro,
      'The couple join their right hands.',
      brotherVow,
      sisterVow,
      pronouncement,
      'The minister gives a word of advice on their knees, then: "Let us Pray".',
    ].join('\n\n')
  }
  const giving =
    giverName?.trim() || 'On behalf of her family, the giver answers: "I do."'
  return [
    'MARRIAGE CEREMONY TWO (the sister is given away).',
    intro,
    `The minister asks: "Who giveth this woman to be married to this man?" ${giving} ` +
      'The giver places the right hand of the sister in the minister’s right hand and retires to his seat. ' +
      'The minister then places the right hand of the sister in the right hand of the brother.',
    brotherVow,
    sisterVow,
    pronouncement,
    'The minister gives a word of advice on their knees, then: "Let us Pray".',
  ].join('\n\n')
}
