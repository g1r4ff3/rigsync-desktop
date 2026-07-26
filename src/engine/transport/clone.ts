/**
 * manifest 저장소 클론 — 실사용에서 드러난 결함 수정: follower의 정상 진입
 * 경로는 "기준(reference) 저장소를 클론해 받는 것"인데, 온보딩엔 그 경로가
 * 없어(`'new'|'existing'` 2택뿐) 사용자가 빈 로컬 디렉터리를 "새로 만들기"로
 * 골라버리면 앱이 아무 경고 없이 "로컬 전용" 정상 상태처럼 보여줬다.
 *
 * `GitTransportProvider.cloneManifest`(실제 `git clone` 호출)는 성공/실패와
 * 원문 stderr만 돌려준다 — 그 원문을 사람 말로 분류하는 게 이 모듈의 역할
 * (Explanability State 층: 실패 케이스를 "그래서 뭘 해야 하나"로 번역).
 */
import type { GitCommandResult, GitTransportProvider } from './types'

export type CloneManifestErrorKind =
  'target-not-empty' | 'auth-failed' | 'not-found' | 'network' | 'unknown'

export interface CloneManifestError {
  readonly kind: CloneManifestErrorKind
  /** git의 원문 출력(디버깅용) -- 사용자용 안내문은 `cloneErrorGuidance`가 별도로 만든다. */
  readonly rawOutput: string
}

export type CloneManifestResult =
  { readonly ok: true } | { readonly ok: false; readonly error: CloneManifestError }

/**
 * git의 영문 에러 텍스트를 분류한다. 정확한 문자열 매칭이 아니라 부분
 * 포함(대소문자 무시)으로 판정한다 -- git 버전마다 문구가 조금씩 다르기
 * 때문에(예: "fatal: destination path 'x' already exists and is not an empty
 * directory."), 넓게 잡고 나머지는 'unknown'으로 떨어뜨려 최소한 원문은
 * 보여준다.
 */
export function classifyCloneFailure(rawOutput: string): CloneManifestError {
  const text = rawOutput.toLowerCase()

  if (text.includes('already exists and is not an empty directory')) {
    return { kind: 'target-not-empty', rawOutput }
  }

  if (
    text.includes('authentication failed') ||
    text.includes('could not read username') ||
    text.includes('could not read password') ||
    text.includes('permission denied (publickey)') ||
    text.includes('403')
  ) {
    return { kind: 'auth-failed', rawOutput }
  }

  if (
    text.includes('could not resolve host') ||
    text.includes('network is unreachable') ||
    text.includes('connection timed out') ||
    text.includes('connection refused') ||
    text.includes('temporary failure in name resolution') ||
    text.includes('unable to access')
  ) {
    return { kind: 'network', rawOutput }
  }

  if (
    text.includes('repository not found') ||
    text.includes('not found') ||
    text.includes('does not exist') ||
    text.includes('does not appear to be a git repository')
  ) {
    return { kind: 'not-found', rawOutput }
  }

  return { kind: 'unknown', rawOutput }
}

/** 온보딩·Settings 양쪽이 공유하는 클론 실행 진입점. */
export function cloneManifestRepo(
  url: string,
  targetDir: string,
  provider: Pick<GitTransportProvider, 'cloneManifest'>
): CloneManifestResult {
  const result: GitCommandResult = provider.cloneManifest(url, targetDir)
  if (result.ok) return { ok: true }
  return { ok: false, error: classifyCloneFailure(result.output) }
}

/** 실패 종류별 한국어 안내문 -- 온보딩/Settings 뷰가 그대로 보여준다. */
export function cloneErrorGuidance(error: CloneManifestError): string {
  switch (error.kind) {
    case 'target-not-empty':
      return (
        '클론 실패 -- 대상 경로가 이미 있고 비어있지 않습니다. ' +
        '다른 경로를 쓰거나 기존 디렉터리를 비켜두세요.'
      )
    case 'auth-failed':
      return (
        '클론 실패 -- 인증에 실패했습니다. private 저장소라면 `gh auth login` 후 ' +
        '`gh auth setup-git`을 실행하거나, 다른 방식으로 git 자격증명을 설정한 뒤 다시 시도하세요.'
      )
    case 'network':
      return '클론 실패 -- 네트워크 문제로 저장소에 접근하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.'
    case 'not-found':
      return '클론 실패 -- 저장소를 찾을 수 없습니다. URL이 정확한지 확인하세요.'
    case 'unknown':
      return `클론 실패 -- ${error.rawOutput.trim().split('\n').at(-1) ?? '원인 불명'}`
  }
}
