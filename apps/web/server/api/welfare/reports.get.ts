import type { WelfareReport } from '../../../types/portal'
import { buildWelfareReport } from '../../utils/welfare-report'

export default defineEventHandler(async (event): Promise<WelfareReport> => {
  return await buildWelfareReport(event)
})
