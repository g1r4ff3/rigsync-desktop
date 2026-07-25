/**
 * scheduled(cron) diff — 구 repo `diff_cron`(rigsync.py:1627) 행동 이식 + 정책이
 * 허용한 라인 수준 diff 개선(`lineDiff`).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { SCHEDULED_STORE_REL_PATH } from './constants'
import type { CronProvider } from './providerTypes'
import type { ScheduledDiffReport } from './types'

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim())
}

export async function diffScheduled(
  ctx: RigsyncContext,
  provider: CronProvider
): Promise<ScheduledDiffReport> {
  const emptyDiff = { added: [], removed: [] }
  if (!provider.isAvailable()) {
    return {
      skipped: true,
      contentChanged: false,
      lineDiff: emptyDiff,
      note: 'crontab not found on PATH -- skipping'
    }
  }

  const storedPath = path.join(ctx.manifestDir, SCHEDULED_STORE_REL_PATH)
  const stored = fs.existsSync(storedPath) ? fs.readFileSync(storedPath, 'utf-8') : null
  const live = provider.readCrontab()

  if (stored === null && live === null) {
    return {
      skipped: false,
      contentChanged: false,
      lineDiff: emptyDiff,
      note: 'no manifest, no live crontab'
    }
  }

  const contentChanged = (stored ?? '') !== (live ?? '')
  const storedLines = new Set(nonEmptyLines(stored ?? ''))
  const liveLines = new Set(nonEmptyLines(live ?? ''))
  // apply는 live crontab을 stored 내용으로 통째로 교체한다 -- 그 기준으로
  // "added"=stored에만 있어 apply가 추가하게 될 줄, "removed"=live에만 있어
  // apply가 지우게 될 줄.
  const added = [...storedLines].filter((l) => !liveLines.has(l))
  const removed = [...liveLines].filter((l) => !storedLines.has(l))

  return { skipped: false, contentChanged, lineDiff: { added, removed } }
}
