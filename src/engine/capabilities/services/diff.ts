/**
 * services diff — 구 repo `diff_services`(rigsync.py:1562) 행동 이식. enabled
 * 불일치는 문자열 인코딩 대신 별도 필드(`enabledMismatch`)로 구조화한다(types.ts
 * 주석 참조 — 정직한 개선).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import { isSubscribed, readSelectionFilter } from '../../selection'
import { SERVICES_KEY_FIELDS, SERVICES_LAYER } from './constants'
import type { SystemdUserProvider } from './providerTypes'
import type { ServicesDiffReport, ServicesManifest } from './types'

export async function diffServices(
  ctx: RigsyncContext,
  provider: SystemdUserProvider
): Promise<ServicesDiffReport> {
  const manifest = effectiveLayer(ctx, SERVICES_LAYER, SERVICES_KEY_FIELDS) as ServicesManifest
  // WS2("창고 모델" 구독 강제): services는 ignore를 지원하지 않아(diff.ts
  // 헤더 주석 참조) selection이 이 capability 최초의 선별 기제다 — 안전
  // 규칙 1은 동일하게 적용(미구독 유닛은 판정만 skip, 제거 plan 없음).
  const selection = readSelectionFilter(ctx, 'services')
  const missing: string[] = []
  const contentChanged: string[] = []
  const enabledMismatch: string[] = []

  for (const u of manifest.unit ?? []) {
    if (!isSubscribed(selection, u.name)) continue
    const liveContent = provider.readUnitFile(u.name)
    if (liveContent === null) {
      missing.push(u.name)
      continue
    }
    const storedPath = path.join(ctx.manifestDir, u.file)
    if (fs.existsSync(storedPath)) {
      const stored = fs.readFileSync(storedPath, 'utf-8')
      if (liveContent !== stored) contentChanged.push(u.name)
    }
    const enabled = await provider.isEnabled(u.name)
    if (enabled !== u.enabled) enabledMismatch.push(u.name)
  }

  return { missing, contentChanged, enabledMismatch }
}
