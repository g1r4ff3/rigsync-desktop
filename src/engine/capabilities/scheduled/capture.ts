/**
 * scheduled(cron) capture — 구 repo `capture_cron`(rigsync.py:1613) 행동 이식.
 * 파일 단위 캡처(라인 단위 아님)라는 계약을 그대로 유지한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { SCHEDULED_STORE_REL_PATH } from './constants'
import type { CronProvider } from './providerTypes'
import type { ScheduledCaptureReport } from './types'

export class FollowerScheduledCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerScheduledCaptureBlockedError'
  }
}

export interface CaptureScheduledOptions {
  readonly dryRun: boolean
}

export async function captureScheduled(
  ctx: RigsyncContext,
  provider: CronProvider,
  options: CaptureScheduledOptions
): Promise<ScheduledCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerScheduledCaptureBlockedError()
  }
  if (!provider.isAvailable()) {
    return {
      skipped: true,
      captured: false,
      lines: 0,
      note: 'crontab not found on PATH -- skipping'
    }
  }

  const tab = provider.readCrontab()
  if (tab === null) {
    return { skipped: false, captured: false, lines: 0, note: 'no crontab for user' }
  }

  const dest = path.join(ctx.manifestDir, SCHEDULED_STORE_REL_PATH)
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, tab)
  }

  return {
    skipped: false,
    captured: true,
    lines: tab.split('\n').filter((l) => l.trim()).length
  }
}
