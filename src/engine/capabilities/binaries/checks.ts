/**
 * binaries doctor 체크 -- refactor-spec-v0.2 F5(P5): "binaries도 fonts와
 * 동일 구조"(fonts/diff.ts 주석 참조) -- 레지스트리 미등록 실행파일은
 * 파일명 정확 일치로만 비교되므로, 파일명에 버전이 박혀 있으면 다른
 * 머신에서 영원히 일치하지 않을 수 있다. fonts/checks.ts와 달리 fc-cache
 * 류 시스템 명령 가용성 체크가 없어(바이너리엔 그런 캐시가 없다) provider가
 * 필요 없는 순수 함수다.
 */
import type { RigsyncContext } from '../../context'
import { isVersionedFilename, VERSIONED_FILENAME_WARNING } from '../../versionedFilename'
import { groupInstalledBinaries } from './scan'

export interface BinariesPreflightCheck {
  /** 레지스트리에 없어 재현 불가능한, 이 머신에 설치된 실행파일 이름. */
  readonly unresolvedInstalled: readonly string[]
  /** unresolvedInstalled 중 버전성 파일명(F5)만 골라 만든 경고. */
  readonly warnings: readonly string[]
}

export function checkBinariesPreflight(
  ctx: Pick<RigsyncContext, 'homeDir'>
): BinariesPreflightCheck {
  const { unresolvedFiles } = groupInstalledBinaries(ctx)
  const warnings = unresolvedFiles
    .filter(isVersionedFilename)
    .map((file) => `${file}: ${VERSIONED_FILENAME_WARNING} -- manifest에 source를 지정해야 합니다`)

  return { unresolvedInstalled: unresolvedFiles, warnings }
}
