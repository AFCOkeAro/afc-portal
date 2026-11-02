export interface MinutesSample {
  id: string
  title: string
  description: string
  body: string
}

export const MINUTES_SAMPLES: MinutesSample[] = [
  {
    id: 'opening',
    title: 'Opening & attendance',
    description: 'Standard opening section',
    body: `# Opening

- **Chairperson:** 
- **Date/Time:** 
- **Venue:** 
- **Opening Prayer:** 
- **Attendance:** 
- **Apologies:** 
- **Minutes of Previous Meeting:** Read and adopted as corrected
`,
  },
  {
    id: 'business',
    title: 'Matters arising / business',
    description: 'Business agenda template',
    body: `# Matters Arising
1. 
2.

# New Business
1. 
2.
`,
  },
  {
    id: 'closing',
    title: 'Closing',
    description: 'Closing section',
    body: `# Closing

- **Closing Prayer:** 
- **Adjournment:** Moved by _____; Seconded by _____
- **Time Adjourned:** 
`,
  },
]
