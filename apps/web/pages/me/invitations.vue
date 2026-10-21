<script setup lang="ts">
/**
 * My invitations + member self-service (AFC-527, wireframes v3 screen 9,
 * US-E2 + member self-service).
 *
 * - Own invitations only, redacted phone + status (server projects the
 *   member shape; technical error detail never reaches this page).
 * - "Ask staff to stop" = withdraw an unsent invite (existing route; members
 *   may withdraw their own unsent rows, staff any in-scope unsent row).
 * - Consent: the member profile surface is OTP-gated (503 until enablement).
 *   Channel consent changes are staff-recorded for now — this page states
 *   that and points at the branch admin instead of inventing a write path.
 *   (Stated choice: no new consent endpoint in this slice; consent writes
 *   arrive with the OTP member-role enablement.)
 *   AFC-538 finding 4 (owner: CTO MediaTech): own-consent self-service has no
 *   dedicated UI in this slice; tracked against the OTP member-role
 *   enablement. Until then consent changes go via the branch admin.
 *
 * Member surface: no `staff` middleware. Anchor sections per
 * prd-addendum-v4 §1.4.
 */

const api = useApi()

interface MemberInvite {
  id: string
  event: string
  channel_choice: string | null
  invitee_name: string | null
  invitee_phone_redacted: string
  invitee_age_band: string | null
  status: string | null
  approval_required: boolean | null
  blocked_reason: string | null
  created_at: string | null
}

interface MemberProfile {
  id: string
  first_name: string | null
  last_name: string | null
  phone_redacted: string | null
  branch: string | null
}

const {
  data: invites,
  pending,
  error,
  refresh,
} = await useAsyncData('me-invitations', () =>
  api.get<{ data: MemberInvite[] }>('/api/invites', { query: { limit: 50 } }),
)
const { data: profile, error: profileError } = await useAsyncData('me-profile', () =>
  api.get<MemberProfile>('/api/member/profile'),
)

const withdrawing = ref<string | null>(null)
const actionError = ref('')
const actionDone = ref('')

const rows = computed(() => invites.value?.data ?? [])

/** Dashboard strip (AFC-588): member scope has no server filters — client-side totals, no new backend. */
const stripItems = computed(() => {
  const all = rows.value
  const actionable = all.filter((row: MemberInvite) =>
    ['pending_approval', 'queued', 'blocked_rate_limit'].includes(row.status ?? ''),
  ).length
  return [
    {
      label: 'My invitations',
      value: all.length,
      to: null,
      hint: 'Total in view',
    },
    {
      label: 'Actionable',
      value: actionable,
      to: null,
      hint: 'Awaiting approval or queued',
    },
  ]
})

const sections = [
  { id: 'invitations', label: 'My invitations' },
  { id: 'consent', label: 'My consent' },
  { id: 'stop', label: 'Ask staff to stop' },
]

const profileDisabled = computed(() => {
  const code = (profileError.value as { code?: string } | null)?.code
  return code === 'member_otp_disabled'
})

function statusColor(status: string | null): 'success' | 'warning' | 'neutral' | 'error' {
  if (status === 'sent' || status === 'delivered' || status === 'registered')
    return 'success'
  if (
    status === 'queued' ||
    status === 'pending_approval' ||
    status === 'blocked_rate_limit'
  )
    return 'warning'
  if (status === 'failed' || status === 'blocked_optout') return 'error'
  return 'neutral'
}

async function withdraw(id: string): Promise<void> {
  withdrawing.value = id
  actionError.value = ''
  actionDone.value = ''
  try {
    await api.post(`/api/invites/${id}/withdraw`)
    actionDone.value =
      'The unsent invitation was withdrawn; the number is blocked for this invite.'
    await refresh()
  } catch (cause) {
    actionError.value =
      cause instanceof Error ? cause.message : 'Could not withdraw the invitation'
  } finally {
    withdrawing.value = null
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="My invitations"
      description="Your own invitations with status only. Phone numbers stay masked; technical detail lives with staff."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Refresh"
          @click="refresh()"
        />
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <SectionNav :sections="sections" />

    <section id="invitations" class="scroll-mt-28">
      <h2 class="sr-only" tabindex="-1">My invitations</h2>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        title="Could not load invitations"
        :description="error.message"
      />
      <div v-else-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>
      <UCard v-else>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">
            Invitations ({{ rows.length }})
          </h2>
        </template>
        <p v-if="rows.length === 0" class="text-sm text-gray-600 dark:text-gray-300">
          No invitations yet. Open an event and choose “Invite someone”.
        </p>
        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="row in rows"
            :key="row.id"
            class="flex flex-wrap items-center gap-3 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ row.invitee_name ?? '—' }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ row.invitee_phone_redacted }} · {{ row.channel_choice ?? 'auto' }} ·
                {{ row.created_at ?? '' }}
              </p>
              <p v-if="row.blocked_reason" class="text-xs text-amber-600">
                {{ row.blocked_reason }}
              </p>
            </div>
            <UBadge :color="statusColor(row.status)" variant="subtle">
              {{ (row.status ?? 'unknown').replaceAll('_', ' ') }}
            </UBadge>
            <UButton
              v-if="
                ['queued', 'pending_approval', 'blocked_rate_limit'].includes(
                  row.status ?? '',
                )
              "
              size="xs"
              color="neutral"
              variant="outline"
              label="Withdraw"
              :loading="withdrawing === row.id"
              @click="withdraw(row.id)"
            />
          </li>
        </ul>
        <UAlert
          v-if="actionError"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Action failed"
          :description="actionError"
        />
        <UAlert
          v-if="actionDone"
          class="mt-3"
          color="success"
          variant="subtle"
          title="Done"
          :description="actionDone"
        />
      </UCard>
    </section>

    <section id="consent" class="mt-8 scroll-mt-28">
      <h2 class="sr-only" tabindex="-1">My consent</h2>
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">
            My consent (WhatsApp / SMS)
          </h2>
        </template>
        <UAlert
          v-if="profileDisabled"
          color="warning"
          variant="subtle"
          title="Member sign-in is not enabled yet"
          description="Phone-OTP member sign-in stays behind the disabled flag until the security re-review and CTO approval land. Your branch admin records channel-consent changes for you in the meantime."
        />
        <div v-else-if="profile" class="text-sm">
          <p>
            <strong>{{ profile.first_name }} {{ profile.last_name }}</strong> ·
            {{ profile.phone_redacted }}
          </p>
          <p class="mt-2 text-gray-600 dark:text-gray-300">
            To change your WhatsApp or SMS consent, or to stop all messages (STOP),
            contact your branch admin — the withdrawal is recorded permanently and
            suppresses every campaign audience, including other campaigns.
          </p>
        </div>
        <UAlert
          v-else-if="profileError"
          color="error"
          variant="subtle"
          title="Could not load your profile"
          :description="profileError.message"
        />
      </UCard>
    </section>

    <section id="stop" class="mt-8 scroll-mt-28">
      <h2 class="sr-only" tabindex="-1">Ask staff to stop</h2>
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">
            Ask staff to stop an invite
          </h2>
        </template>
        <p class="text-sm text-gray-600 dark:text-gray-300">
          Use <strong>Withdraw</strong> above for any invite that has not been sent yet —
          that stops it immediately. For a message already sent, or to block a number
          entirely, contact your branch admin: opt-outs are permanent and staff cannot
          override them.
        </p>
      </UCard>
    </section>
  </div>
</template>
