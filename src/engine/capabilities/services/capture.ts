/**
 * services capture — 구 repo `capture_services`(rigsync.py:1542) 행동 이식.
 *
 * 내용 수준 비밀 스캔: unit 파일(Environment=TOKEN=... 등)에 비밀이 있으면
 * 그 unit만 캡처에서 빠진다(entry 단위 granularity — dotfiles와 동일 원칙,
 * 다른 unit들의 캡처는 계속 진행).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import {
  hostLayerPath,
  readCommonLayer,
  readHostLayer,
  writeCommonLayer,
  writeManifestFile
} from '../../manifest'
import { filterAllowlistedFindings, readSecretAllowlist } from '../../safety/secretAllowlist'
import { scanTextForSecrets } from '../../safety/secretScan'
import { SERVICES_LAYER } from './constants'
import type { SystemdUserProvider } from './providerTypes'
import type {
  ServicesCaptureReport,
  ServicesManifest,
  ServicesSecretScanBlockedEntry,
  ServiceUnitEntry
} from './types'

export class FollowerServicesCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerServicesCaptureBlockedError'
  }
}

export interface CaptureServicesOptions {
  readonly dryRun: boolean
}

export async function captureServices(
  ctx: RigsyncContext,
  provider: SystemdUserProvider,
  options: CaptureServicesOptions
): Promise<ServicesCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerServicesCaptureBlockedError()
  }

  const existing = (readCommonLayer(ctx, SERVICES_LAYER) as ServicesManifest).unit ?? []
  const entries = new Map<string, ServiceUnitEntry>(existing.map((u) => [u.name, u]))
  // refactor-spec-v0.2 P2 (F2 host 라우팅): 이 호스트 오버레이에 있는 유닛은
  // 머신 고유 항목이다 — 페이로드(유닛 파일·enabled 상태)는 캡처하되 host
  // 계층만 갱신하고 common엔 절대 되돌리지 않는다. 그렇지 않으면 host로
  // 옮긴 랩 전용 유닛(F1의 cliproxyapi)을 다음 capture가 도로 전 머신에
  // 배포한다(dotfiles capture의 host-only 처리와 같은 원칙).
  const hostDoc = readHostLayer(ctx, SERVICES_LAYER) as ServicesManifest
  const hostEntries = new Map<string, ServiceUnitEntry>(
    (hostDoc.unit ?? []).map((u) => [u.name, u])
  )
  const outDir = path.join(ctx.manifestDir, 'services', 'systemd-user')
  const allowlist = readSecretAllowlist(ctx)

  let skippedSecretScan = 0
  const secretScanBlocked: ServicesSecretScanBlockedEntry[] = []

  for (const u of provider.listUnitFiles()) {
    const displayPath = `services/systemd-user/${u.name}`
    const blockedFindings = filterAllowlistedFindings(
      allowlist,
      scanTextForSecrets(u.content, displayPath)
    )
    if (blockedFindings.length > 0) {
      skippedSecretScan += 1
      secretScanBlocked.push({ name: u.name, findings: blockedFindings })
      continue
    }

    const enabled = await provider.isEnabled(u.name)
    if (!options.dryRun) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, u.name), u.content)
    }
    if (hostEntries.has(u.name)) {
      hostEntries.set(u.name, { ...hostEntries.get(u.name)!, file: displayPath, enabled })
    } else {
      entries.set(u.name, { name: u.name, file: displayPath, enabled })
    }
  }

  if (!options.dryRun) {
    writeCommonLayer(ctx, SERVICES_LAYER, entries.size > 0 ? { unit: [...entries.values()] } : {})
    if (hostEntries.size > 0) {
      writeManifestFile(hostLayerPath(ctx, SERVICES_LAYER), {
        ...hostDoc,
        unit: [...hostEntries.values()]
      })
    }
  }

  return { captured: entries.size + hostEntries.size, skippedSecretScan, secretScanBlocked }
}
