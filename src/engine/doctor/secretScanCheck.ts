/**
 * ⑥ 소급 스캔(retroactive scan) — manifest 스토어 전체를 다시 스캔해 Doctor에
 * "Secret scan" 그룹으로 노출한다. capture 관문(각 capability의 capture.ts)이
 * 도입되기 전에 이미 캡처됐거나, manifest를 수동 편집해 관문을 우회한 경우를
 * 잡는 마지막 안전망 -- `../transport/sync.ts`의 push 게이트와 같은
 * `scanManifestForSecrets`를 재사용한다(스캔 로직은 한 곳).
 */
import type { RigsyncContext } from '../context'
import { scanManifestForSecrets } from '../safety/manifestScan'
import type { SecretFinding } from '../safety/secretScan'

export interface SecretScanPreflightCheck {
  /** allowlist로 걸러진 뒤 남은, 아직 조치되지 않은 finding들. 비어 있으면 통과. */
  readonly blockedFindings: readonly SecretFinding[]
  /** 사람이 읽는 경고 문장 -- 절대 원문 값을 담지 않는다(finding.maskedExcerpt만 사용). */
  readonly warnings: readonly string[]
}

export function checkSecretScanPreflight(
  ctx: Pick<RigsyncContext, 'manifestDir'>
): SecretScanPreflightCheck {
  const { findings } = scanManifestForSecrets(ctx)
  const warnings = findings.map(
    (f) =>
      `${f.path}:${f.line} -- ${f.label} (${f.maskedExcerpt}) -- ` +
      '해당 파일을 제외하거나, 비밀을 별도 파일로 분리한 뒤 다시 Capture하세요'
  )
  return { blockedFindings: findings, warnings }
}
