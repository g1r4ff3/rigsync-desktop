/**
 * scheduled(cron) capture — 구 repo `capture_cron`(rigsync.py:1613) 행동 이식.
 * 파일 단위 캡처(라인 단위 아님)라는 계약을 그대로 유지한다.
 *
 * 내용 수준 비밀 스캔: crontab은 파일 단위 계약이라(라인 부분 캡처 없음)
 * 비밀이 하나라도 걸리면 crontab 전체를 스토어에 쓰지 않는다(denylist 없는
 * capability라 이 스캔이 유일한 안전선).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { filterAllowlistedFindings, readSecretAllowlist } from '../../safety/secretAllowlist'
import { scanTextForSecrets } from '../../safety/secretScan'
import { SCHEDULED_STORE_REL_PATH } from './constants'
import { scheduledStorePath } from './store'
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
      note: 'crontab not found on PATH -- skipping',
      secretScanBlocked: []
    }
  }

  const tab = provider.readCrontab()
  if (tab === null) {
    return {
      skipped: false,
      captured: false,
      lines: 0,
      note: 'no crontab for user',
      secretScanBlocked: []
    }
  }

  const allowlist = readSecretAllowlist(ctx)
  const blockedFindings = filterAllowlistedFindings(
    allowlist,
    scanTextForSecrets(tab, SCHEDULED_STORE_REL_PATH)
  )
  if (blockedFindings.length > 0) {
    return {
      skipped: false,
      captured: false,
      lines: 0,
      note: `refused (secret scan): crontab -- ${blockedFindings.length}건 감지, 캡처 안 함`,
      secretScanBlocked: blockedFindings
    }
  }

  // F2 host 라우팅: host 스토어가 있으면 이 머신의 crontab은 거기로만 간다
  // (공통 스토어를 건드리지 않아 다른 머신에 새지 않는다 — store.ts 주석).
  const dest = scheduledStorePath(ctx)
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, tab)
  }

  return {
    skipped: false,
    captured: true,
    lines: tab.split('\n').filter((l) => l.trim()).length,
    secretScanBlocked: []
  }
}
