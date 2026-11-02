/**
 * Minutes sample templates (AFC-670).
 *
 * Two loadable samples for the `/minutes/new` editor — a council meeting
 * and a welfare visit — exercising every toolbar construct (headings,
 * bold, italic, underline, strike, lists, quote, code, table, link) so a
 * new recorder sees the Markdown shape before typing. Samples live here as
 * editor content only: they are never inserted as database rows unless the
 * recorder saves the form.
 */

export interface MinutesSample {
  id: string
  title: string
  description: string
  body: string
}

export const MINUTES_SAMPLES: MinutesSample[] = [
  {
    id: 'council-meeting',
    title: 'Council meeting',
    description: 'Branch council session with attendance table and resolutions.',
    body: [
      '# Branch Council Meeting — October 2026',
      '',
      '**Venue:** Anthony Village Tabernacle, Main Hall',
      '**Chair:** Branch Head · **Recorder:** Secretary',
      '',
      '## Attendance',
      '',
      '| Name | Role | Present |',
      '| ---- | ---- | ------- |',
      '| T. Adeyemi | Branch Head | Yes |',
      '| F. Okonkwo | Secretary | Yes |',
      '| S. Balogun | Welfare Lead | ++Apology++ |',
      '',
      '## Opening',
      '',
      '> The meeting opened with prayer and a charge to *serve faithfully* in every duty assigned.',
      '',
      '## Matters arising',
      '',
      '- Roof repair: **completed** ahead of the rains.',
      '- Youth vigil roster: draft circulated for *review*.',
      '- ~~Bus purchase~~ deferred to next quarter.',
      '',
      '## Resolutions',
      '',
      '1. Approve the welfare visit to the Adebayo family on Saturday.',
      '2. Publish the vigil roster by `Friday 18:00`.',
      '3. Next meeting: first Sunday of next month, `10:00`.',
      '',
      'See the [branch calendar](/calendar) for confirmed dates.',
      '',
    ].join('\n'),
  },
  {
    id: 'welfare-visit',
    title: 'Welfare visit',
    description: 'Short field-visit record with needs list and follow-up.',
    body: [
      '# Welfare Visit — Adebayo Family',
      '',
      '**Date:** Saturday · **Team:** Welfare Lead + two volunteers',
      '',
      '## Observed needs',
      '',
      '- School fees balance of **₦45,000** for two children.',
      '- Roof leak over the *back room*; needs a carpenter.',
      '- ~~Food hamper~~ already delivered last week.',
      '',
      '## Action',
      '',
      '> Follow up on **Tuesday** with the itemised school bill before any payment.',
      '',
      '## Follow-up',
      '',
      '1. Collect the itemised bill (`receipt required`).',
      '2. Get one carpenter quote for the ++back room++ roof.',
      '3. Report back at the next council meeting.',
      '',
    ].join('\n'),
  },
]
