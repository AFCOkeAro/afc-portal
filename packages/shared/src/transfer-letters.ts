export interface LetterTemplate {
  id: string
  title: string
  description: string
  body: string
}

export const TRANSFER_LETTER_TEMPLATES: LetterTemplate[] = [
  {
    id: 'transfer_domestic',
    title: 'Domestic Transfer Letter',
    description:
      'Letter from Area Overseer to new Area Overseer for within-Nigeria transfer.',
    body: 'Lorem ipsum dolor sit amet. Transfer letter template placeholder.',
  },
  {
    id: 'transfer_international',
    title: 'International Transfer Letter',
    description:
      'Letter for relocation to another country, escalated to WECA Headquarters.',
    body: 'Lorem ipsum dolor sit amet. International transfer letter template placeholder.',
  },
  {
    id: 'student_introduction',
    title: 'Student Introduction Letter',
    description: 'Introduction letter for a student gaining admission to school.',
    body: 'Lorem ipsum dolor sit amet. Student introduction letter template placeholder.',
  },
  {
    id: 'attestation',
    title: 'Attestation Letter',
    description: 'Attestation letter for students, approved by Area Overseer.',
    body: 'Lorem ipsum dolor sit amet. Attestation letter template placeholder.',
  },
]

export function getTransferLetterTemplate(id: string): LetterTemplate | undefined {
  return TRANSFER_LETTER_TEMPLATES.find(function (t) {
    return t.id === id
  })
}
