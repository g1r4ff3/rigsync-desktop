/**
 * Secret denylist — invariant ③ (CLAUDE.md 안전 불변식): capture는 어떤 경로로도
 * 시크릿을 담지 않는다. 패턴은 구 repo `~/repos/rigsync/rigsync.py`의
 * `DENYLIST_PATTERNS` / `matches_denylist` 행동을 옮긴 것 (코드 복사 아님).
 *
 * 매칭 대상은 항상 **basename**(디렉터리 성분 없이 파일명만)이다 — 호출부가
 * 전체 경로가 아니라 최종 path segment를 넘겨야 한다.
 */

export const DENYLIST_PATTERNS: readonly string[] = [
  'id_*',
  '*.pem',
  '*_history',
  'known_hosts*',
  '*token*',
  '*.key',
  'credentials*',
  '.env*',
  // C단계 실사례: "secrets.zsh" 같은 이름 기반 파일이 위 패턴 어디에도
  // 안 걸려 통과했다 — "secret"을 basename 어디에 두든(접두/접미/중간)
  // 잡히게 *token*과 같은 형태로 추가.
  '*secret*'
]

/**
 * shell-glob(`fnmatch`) 스타일의 아주 작은 하위집합만 변환한다 — 이 모듈이
 * 다루는 패턴은 전부 `*`만 쓰고 문자 클래스(`[...]`)나 `?`는 쓰지 않지만,
 * 구 repo의 `fnmatch.fnmatch` 의미를 최대한 좁게 재현하기 위해 `?`도 지원한다.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

const DENYLIST_REGEXPS = DENYLIST_PATTERNS.map(globToRegExp)

/**
 * basename이 시크릿 denylist 패턴 중 하나에 매치하면 true.
 *
 * @param basename 경로의 마지막 세그먼트 (예: "id_ed25519", "credentials_test").
 *   전체 경로를 넘기지 않는다 — 디렉터리 이름에 우연히 패턴이 섞여 있어도
 *   무시하려면 호출부가 `path.basename()`으로 미리 잘라 넘겨야 한다.
 */
export function matchesDenylist(basename: string): boolean {
  return DENYLIST_REGEXPS.some((re) => re.test(basename))
}
