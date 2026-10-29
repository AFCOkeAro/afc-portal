/**
 * Worship planner templates (AFC-870).
 *
 * Ten in-code order-of-service templates (Sunday Morning, Midweek,
 * Communion, Easter, Christmas Eve, Good Friday, Harvest Thanksgiving,
 * Night Vigil, Baptism Service, Youth Service). Each template is a named
 * list of items with a per-item duration in minutes; the total is derived.
 *
 * Templates live in code, not in the database — the same posture as
 * task-templates (AFC-668): staging DDL is frozen, and an order of
 * service is a workflow definition, not tenant data. Applying a template
 * fans out to the ordinary POST /api/services row (theme + service_type
 * prefilled, notes carrying the item list), so permissions, validation
 * and the service audit trail are unchanged. There is no new collection,
 * no new privilege, and no new DELETE surface.
 */

export interface WorshipTemplateItem {
  title: string
  /** Planned minutes for this item. */
  durationMin: number
}

export interface WorshipTemplate {
  id: string
  name: string
  description: string
  /** Prefilled sunday_services.service_type when planning from this template. */
  serviceType: 'sunday' | 'midweek' | 'special' | 'camp'
  items: WorshipTemplateItem[]
}

export const WORSHIP_TEMPLATES: readonly WorshipTemplate[] = [
  {
    id: 'sunday_morning',
    name: 'Sunday Morning',
    description: 'Call to worship, praise, Word, offering and benediction.',
    serviceType: 'sunday',
    items: [
      { title: 'Call to worship and opening prayer', durationMin: 10 },
      { title: 'Praise and worship', durationMin: 30 },
      { title: 'Choir ministration', durationMin: 10 },
      { title: 'Announcements and welcome', durationMin: 10 },
      { title: 'Offering', durationMin: 10 },
      { title: 'Sermon', durationMin: 45 },
      { title: 'Altar call and closing prayer', durationMin: 15 },
      { title: 'Benediction', durationMin: 5 },
    ],
  },
  {
    id: 'midweek',
    name: 'Midweek',
    description: 'Shorter midweek Word and prayer service.',
    serviceType: 'midweek',
    items: [
      { title: 'Opening prayer', durationMin: 5 },
      { title: 'Praise and worship', durationMin: 20 },
      { title: 'Word', durationMin: 40 },
      { title: 'Prayers', durationMin: 15 },
      { title: 'Offering and closing', durationMin: 10 },
    ],
  },
  {
    id: 'communion',
    name: 'Communion',
    description: 'Sunday order with the Lord\u2019s table and foot-washing note.',
    serviceType: 'sunday',
    items: [
      { title: 'Call to worship and opening prayer', durationMin: 10 },
      { title: 'Praise and worship', durationMin: 25 },
      { title: 'Sermon', durationMin: 40 },
      { title: 'Communion', durationMin: 20 },
      { title: 'Offering', durationMin: 10 },
      { title: 'Benediction', durationMin: 5 },
    ],
  },
  {
    id: 'easter',
    name: 'Easter',
    description: 'Resurrection celebration with cantata and thanksgiving.',
    serviceType: 'special',
    items: [
      { title: 'Processional and opening prayer', durationMin: 10 },
      { title: 'Praise and worship', durationMin: 30 },
      { title: 'Choir cantata', durationMin: 25 },
      { title: 'Sermon', durationMin: 40 },
      { title: 'Thanksgiving offering', durationMin: 15 },
      { title: 'Benediction', durationMin: 5 },
    ],
  },
  {
    id: 'christmas_eve',
    name: 'Christmas Eve',
    description: 'Carols, lessons and candlelight closing.',
    serviceType: 'special',
    items: [
      { title: 'Opening prayer', durationMin: 10 },
      { title: 'Carols and lessons', durationMin: 40 },
      { title: 'Choir ministration', durationMin: 15 },
      { title: 'Short exhortation', durationMin: 20 },
      { title: 'Offering', durationMin: 10 },
      { title: 'Candlelight closing', durationMin: 10 },
    ],
  },
  {
    id: 'good_friday',
    name: 'Good Friday',
    description: 'Solemn Word, reflections and quiet closing.',
    serviceType: 'special',
    items: [
      { title: 'Opening prayer', durationMin: 10 },
      { title: 'Hymns and reflections', durationMin: 30 },
      { title: 'Sermon', durationMin: 45 },
      { title: 'Quiet prayers', durationMin: 15 },
      { title: 'Closing', durationMin: 5 },
    ],
  },
  {
    id: 'harvest_thanksgiving',
    name: 'Harvest Thanksgiving',
    description: 'Thanksgiving service with produce presentation.',
    serviceType: 'special',
    items: [
      { title: 'Call to worship', durationMin: 10 },
      { title: 'Praise and worship', durationMin: 30 },
      { title: 'Harvest presentation', durationMin: 20 },
      { title: 'Sermon', durationMin: 35 },
      { title: 'Thanksgiving offering', durationMin: 15 },
      { title: 'Benediction', durationMin: 5 },
    ],
  },
  {
    id: 'night_vigil',
    name: 'Night Vigil',
    description: 'Extended praise, Word and prayer blocks.',
    serviceType: 'special',
    items: [
      { title: 'Opening prayer', durationMin: 15 },
      { title: 'Praise and worship', durationMin: 45 },
      { title: 'Word (first charge)', durationMin: 40 },
      { title: 'Prayer blocks', durationMin: 60 },
      { title: 'Word (second charge)', durationMin: 30 },
      { title: 'Offering and closing', durationMin: 15 },
    ],
  },
  {
    id: 'baptism_service',
    name: 'Baptism Service',
    description: 'Short charge, baptism by immersion and reception.',
    serviceType: 'special',
    items: [
      { title: 'Opening prayer', durationMin: 10 },
      { title: 'Praise and worship', durationMin: 20 },
      { title: 'Baptism charge', durationMin: 20 },
      { title: 'Baptism', durationMin: 30 },
      { title: 'Reception and closing', durationMin: 15 },
    ],
  },
  {
    id: 'youth_service',
    name: 'Youth Service',
    description: 'Youth-led praise, Word and breakout charge.',
    serviceType: 'sunday',
    items: [
      { title: 'Opening prayer', durationMin: 5 },
      { title: 'Youth praise', durationMin: 30 },
      { title: 'Word', durationMin: 35 },
      { title: 'Breakout charge', durationMin: 20 },
      { title: 'Offering and closing', durationMin: 10 },
    ],
  },
]

export function getWorshipTemplate(id: string): WorshipTemplate | undefined {
  return WORSHIP_TEMPLATES.find((template) => template.id === id)
}

/** Sum of item durations, in minutes. */
export function worshipTemplateDuration(template: WorshipTemplate): number {
  return template.items.reduce((sum, item) => sum + item.durationMin, 0)
}

/** Render the item list as plain-text notes for a prefilled service form. */
export function worshipTemplateNotes(template: WorshipTemplate): string {
  const lines = template.items.map(
    (item, index) => `${index + 1}. ${item.title} (${item.durationMin} min)`,
  )
  return [`Order of service — ${template.name}:`, ...lines].join('\n')
}
