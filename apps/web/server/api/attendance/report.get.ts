import type { AttendanceReport } from '../../../types/portal'
import { buildAttendanceReport } from '../../utils/attendance-report'

export default defineEventHandler(async (event): Promise<AttendanceReport> => {
  return await buildAttendanceReport(event)
})
