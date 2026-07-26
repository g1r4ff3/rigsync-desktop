/**
 * 온보딩 "기존 경로 지정"의 검증 — 지금까진 무검증 `mkdir -p`라 follower가
 * 빈 로컬 디렉터리를 가리켜도 조용히 "정상"처럼 보였다(실사용에서 드러난
 * 결함). 여기는 **경고만** 만든다 -- 새 manifest를 의도적으로 시작하는
 * 경우도 있으므로 진행 자체를 막지 않는다(코디네이터 지시).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { GitTransportProvider } from './transport/types'

export interface ManifestPathCheckResult {
  readonly exists: boolean
  readonly isGitRepo: boolean
  readonly hasRemote: boolean
  /** `<targetDir>/common/` 존재 여부 -- manifest 레이어가 있다는 최소 신호. */
  readonly hasManifestStructure: boolean
  readonly warnings: readonly string[]
}

export function checkExistingManifestPath(
  targetDir: string,
  gitProvider: Pick<GitTransportProvider, 'isGitRepo' | 'hasRemote'>
): ManifestPathCheckResult {
  const exists = fs.existsSync(targetDir)
  if (!exists) {
    return {
      exists: false,
      isGitRepo: false,
      hasRemote: false,
      hasManifestStructure: false,
      warnings: [
        '이 경로가 아직 없습니다 -- "새로 만들기"와 동일하게 빈 디렉터리로 시작합니다. ' +
          'follower라면 기준 저장소를 클론해야 합니다(위 "저장소에서 클론"을 선택하세요).'
      ]
    }
  }

  const isGitRepo = gitProvider.isGitRepo(targetDir)
  const hasRemote = isGitRepo && gitProvider.hasRemote(targetDir)
  const hasManifestStructure = fs.existsSync(path.join(targetDir, 'common'))

  const warnings: string[] = []
  if (!isGitRepo) {
    warnings.push(
      '이 경로는 git 저장소가 아닙니다 -- 다른 머신과 자동 동기화(commit/push/pull)가 되지 않고 이 머신에서만 로컬로 동작합니다.'
    )
  } else if (!hasRemote) {
    warnings.push(
      '이 경로는 git 저장소지만 원격이 연결돼 있지 않습니다 -- 이 머신은 로컬 전용으로 동작하고 다른 머신과 동기화되지 않습니다.'
    )
  }
  if (!hasManifestStructure) {
    warnings.push(
      '이 경로엔 manifest(common/)가 없습니다 -- follower라면 기준 저장소를 클론해야 합니다. ' +
        '새 manifest를 여기서 시작하려는 것이라면 이 경고는 무시해도 됩니다.'
    )
  }

  return { exists, isGitRepo, hasRemote, hasManifestStructure, warnings }
}
