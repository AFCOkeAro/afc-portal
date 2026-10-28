<script setup lang="ts">
import { COLLECTIONS, workingDaysBetween } from '@afc/shared'

/**
 * Time Off (AFC-854 phase 1): minimal church HR.
 *
 * Annual allowances per person per year, plus a working-day calculator
 * for planning leave (weekends skipped; public holidays are not subtracted
 * yet — no holiday register, recorded as the phase-2 gap). Used and
 * remaining days compute against leave_requests in phase 2, once that
 * slice has landed.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()

interface LeaveBalance {
  id: string
  person: string | null
  name: string | null
  year: number
  allowance_days: number
}

const canManage = computed(() => permissions.can(COLLECTIONS.leaveBalances, 'create'))

const yearFilter = ref(String(new Date().getFullYear()))
const balances = ref<LeaveBalance[]>([])
const balancesPending = ref(false)
const balancesError = ref('')
const newBalance = ref({
  person: '',
  year: String(new Date().getFullYear()),
  allowance: '21',
})
const balanceSaving = ref(false)
const balanceError = ref('')
const calcStart = ref('')
const calcEnd = ref('')

const yearItems = computed(() => {
  const current = new Date().getFullYear()
  return [current - 1, current, current + 1].map((year) => ({
    label: String(year),
    value: String(year),
  }))
})

/** Working days in the calculator range, null until both dates parse. */
const calcDays = computed(() => {
  if (calcStart.value === '' || calcEnd.value === '') return null
  return workingDaysBetween(calcStart.value, calcEnd.value)
})

async function loadBalances(): Promise<void> {
  balancesPending.value = true
  balancesError.value = ''
  try {
    const res = await api.get<{ data: LeaveBalance[] }>('/api/leave-balances', {
      query: yearFilter.value === '' ? {} : { year: yearFilter.value },
    })
    balances.value = res.data ?? []
  } catch (cause) {
    balancesError.value =
      (cause as { message?: string }).message ?? 'Could not load allowances'
  } finally {
    balancesPending.value = false
  }
}

async function setAllowance(): Promise<void> {
  if (newBalance.value.person === '') {
    balanceError.value = 'Choose who the allowance is for.'
    return
  }
  balanceSaving.value = true
  balanceError.value = ''
  try {
    await api.post('/api/leave-balances', {
      person: newBalance.value.person,
      year: Number(newBalance.value.year),
      allowance_days: Number(newBalance.value.allowance),
    })
    newBalance.value = {
      person: '',
      year: String(new Date().getFullYear()),
      allowance: '21',
    }
    await loadBalances()
  } catch (cause) {
    balanceError.value =
      (cause as { message?: string }).message ?? 'Could not set the allowance'
  } finally {
    balanceSaving.value = false
  }
}

async function removeBalance(id: string): Promise<void> {
  balanceError.value = ''
  try {
    await api.remove(`/api/leave-balances/${id}`)
    await loadBalances()
  } catch (cause) {
    balanceError.value =
      (cause as { message?: string }).message ?? 'Could not remove the allowance'
  }
}

onMounted(() => {
  void loadBalances()
})

watch(yearFilter, () => {
  void loadBalances()
})
</script>

<template>
  <div>
    <PageHeader
      title="Time Off"
      description="Annual leave allowances in working days. Used and remaining days arrive with phase 2, computed against leave requests."
    />
    <div class="mt-4 flex flex-wrap items-end gap-2">
      <UFormField label="Year" class="w-40">
        <USelect v-model="yearFilter" :items="yearItems" class="w-full" />
      </UFormField>
    </div>
    <p v-if="balancesPending" class="mt-3 text-sm text-gray-500">Loading allowances…</p>
    <p v-else-if="balancesError !== ''" class="mt-3 text-sm text-red-600">
      {{ balancesError }}
    </p>
    <div v-else-if="balances.length === 0" class="mt-3">
      <UCard>
        <EmptyState
          title="No allowances yet"
          description="Set the first annual allowance below."
        />
      </UCard>
    </div>
    <ul v-else class="mt-3 space-y-2">
      <li
        v-for="row in balances"
        :key="row.id"
        class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{
          row.name ?? 'Unknown'
        }}</span>
        <UBadge color="neutral" variant="subtle">{{ row.year }}</UBadge>
        <span class="text-gray-600 dark:text-gray-400"
          >{{ row.allowance_days }} days</span
        >
        <UButton
          v-if="canManage"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="`Remove allowance for ${row.name}`"
          @click="removeBalance(row.id)"
        />
      </li>
    </ul>
    <div class="mt-4 grid gap-3 lg:grid-cols-2">
      <UCard v-if="canManage">
        <template #header>
          <h3 class="font-semibold">Set allowance</h3>
        </template>
        <div class="grid gap-2 sm:grid-cols-2">
          <UFormField label="Person" class="sm:col-span-2">
            <EntitySelect
              v-model="newBalance.person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
          <UFormField label="Year">
            <USelect v-model="newBalance.year" :items="yearItems" class="w-full" />
          </UFormField>
          <UFormField label="Days">
            <UInput v-model="newBalance.allowance" type="number" min="0" class="w-full" />
          </UFormField>
        </div>
        <UButton
          class="mt-3"
          label="Set allowance"
          icon="i-lucide-plus"
          :loading="balanceSaving"
          @click="setAllowance"
        />
        <p v-if="balanceError !== ''" class="mt-2 text-sm text-red-600">
          {{ balanceError }}
        </p>
      </UCard>
      <UCard>
        <template #header>
          <h3 class="font-semibold">Working-day calculator</h3>
          <p class="mt-1 text-xs text-gray-500">
            Weekends skipped. Public holidays not subtracted yet.
          </p>
        </template>
        <div class="grid gap-2 sm:grid-cols-2">
          <UFormField label="Start">
            <UInput v-model="calcStart" type="date" class="w-full" />
          </UFormField>
          <UFormField label="End">
            <UInput v-model="calcEnd" type="date" class="w-full" />
          </UFormField>
        </div>
        <p class="mt-3 text-sm">
          <span v-if="calcDays === null" class="text-gray-500">Pick both dates.</span>
          <span v-else class="font-semibold">{{ calcDays }} working days</span>
        </p>
      </UCard>
    </div>
  </div>
</template>
