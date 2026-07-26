/**
 * manifest 전체 스캔 — ⑤ push 직전 재검사(이중 안전망)와 ⑥ 소급 스캔(Doctor)이
 * 공유하는 진입점. capture 직전 관문(각 capability의 capture.ts)을 어떤 경로로든
 * 우회해 manifest에 비밀이 들어간 경우(예: 수동 편집, allowlist 삭제 전 캡처분)를
 * 잡는 마지막 안전망이다.
 */
import type { RigsyncContext } from '../context'
import { filterAllowlistedFindings, readSecretAllowlist } from './secretAllowlist'
import { scanTreeForSecrets, type SecretFinding } from './secretScan'
import fs from 'node:fs'

export interface ManifestScanResult {
  readonly findings: readonly SecretFinding[]
  readonly blocked: boolean
}

/** `<manifestDir>` 전체(`.git` 제외)를 스캔하고 allowlist로 걸러낸다. */
export function scanManifestForSecrets(
  ctx: Pick<RigsyncContext, 'manifestDir'>
): ManifestScanResult {
  if (!fs.existsSync(ctx.manifestDir)) {
    return { findings: [], blocked: false }
  }
  const allowlist = readSecretAllowlist(ctx)
  const { findings: rawFindings } = scanTreeForSecrets(ctx.manifestDir, '')
  const findings = filterAllowlistedFindings(allowlist, rawFindings)
  return { findings, blocked: findings.length > 0 }
}
