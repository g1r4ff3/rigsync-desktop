/**
 * "manifest dirty" 검사 — refactor-spec-v0.2 P3, F3(D2-a) 구현.
 *
 * F3 병인: follower의 홈 파일은 apply 후 manifest 작업 트리로의 심링크다.
 * follower에서 그 파일을 로컬 편집하면(자연스러운 행위) manifest 작업 트리가
 * dirty해지고, 다음 `git pull --ff-only`가 실패해 동기화가 그 자리에서 정지한다
 * (follower는 저작하지 않는다는 계약이라 이 dirt를 스스로 정리할 수단이 없다).
 *
 * 이 검사는 단순히 "dirty한가"뿐 아니라 **역할에 따라 의미가 다르다**는 것을
 * 그대로 반영한다:
 * - follower: 위 병인 그대로 위험 — warn.
 * - reference: 심링크 너머 라이브 편집은 정상적인 워크플로이고, P4(F4/D3-a,
 *   `sweepLiveEditsIfDirty`)가 다음 드리프트 주기·다음 캡처/토글 전에 자동으로
 *   `live-edit: dotfiles 라이브 편집` 커밋으로 분리해 처리한다 -- 그래서 경고가
 *   아니라 중립 정보(note)다.
 */
import type { RigsyncContext, Role } from '../context'
import type { GitTransportProvider } from '../transport/types'

export interface ManifestDirtyFile {
  /** git porcelain XY 코드 그대로(예: ` M`, `??`). */
  readonly status: string
  /** manifestDir 기준 상대 경로. */
  readonly path: string
}

export interface ManifestDirtyCheckResult {
  readonly role: Role
  readonly dirty: boolean
  readonly files: readonly ManifestDirtyFile[]
  /** dirty && role==='follower'일 때만 채워진다 -- Doctor 요약 카운트(warn)에 반영. */
  readonly warning?: string
  /** dirty && role==='reference'일 때만 채워진다 -- 중립 정보, 카운트에 반영되지 않는다. */
  readonly note?: string
}

function formatFileList(files: readonly ManifestDirtyFile[]): string {
  const shown = files.slice(0, 5).map((f) => f.path)
  const more = files.length > 5 ? ` 외 ${files.length - 5}개` : ''
  return shown.join(', ') + more
}

export async function checkManifestDirty(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'role'>,
  provider: Pick<GitTransportProvider, 'isGitRepo' | 'changedFiles'>
): Promise<ManifestDirtyCheckResult> {
  if (!(await provider.isGitRepo(ctx.manifestDir))) {
    return { role: ctx.role, dirty: false, files: [] }
  }

  const files = await provider.changedFiles(ctx.manifestDir)
  if (files.length === 0) {
    return { role: ctx.role, dirty: false, files: [] }
  }

  if (ctx.role === 'follower') {
    return {
      role: ctx.role,
      dirty: true,
      files,
      warning:
        `manifest 로컬 편집 감지(${files.length}건) -- 다음 pull이 실패해 동기화가 정지합니다. ` +
        '편집을 되돌리거나(git checkout), 바꾸고 싶은 내용이면 reference 머신에서 반영한 뒤 ' +
        `다시 받으세요. 변경 파일: ${formatFileList(files)}`
    }
  }

  return {
    role: ctx.role,
    dirty: true,
    files,
    note:
      `커밋 안 된 라이브 편집 ${files.length}건 -- 다음 드리프트 주기에 자동으로 커밋됩니다. ` +
      `변경 파일: ${formatFileList(files)}`
  }
}
