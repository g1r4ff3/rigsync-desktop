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
  // 2026-07-26 확대: 구 repo는 `credentials*`(접두 고정)라 선행 점이 붙은
  // `.git-credentials`·`.credentials_test`가 통과했다. 구 repo 이식 계약을
  // 유지하지 않기로 한 결정(사용자 승인)에 따라 `*token*`·`*secret*`과 같은
  // 형태로 넓힌다 — basename 어디에 있든 잡는다.
  '*credentials*',
  '.env*',
  // C단계 실사례: "secrets.zsh" 같은 이름 기반 파일이 위 패턴 어디에도
  // 안 걸려 통과했다 — "secret"을 basename 어디에 두든(접두/접미/중간)
  // 잡히게 *token*과 같은 형태로 추가.
  '*secret*',
  // 2026-07-26 실사례(Zotero WebDAV 브리지 세팅): 자격증명 파일 두 개가 이름
  // 기반 방어를 그대로 통과했다.
  //   ① "zotero-webdav.env" — `.env*`는 **선행 점**을 요구해서 안 걸린다.
  //      확장자가 .env면 위치와 무관하게 환경변수 파일이므로 접미 형태로 추가.
  //   ② "rclone.conf" — 이름은 평범한데 내용이 OAuth refresh token이다.
  //      "이름은 무해, 내용은 자격증명" 부류는 개별 등재 외에 방법이 없다.
  // 같은 부류로 알려진 `.netrc`도 함께 등재한다
  // (`.git-credentials`는 위 `*credentials*` 확대로 이미 잡힌다).
  '*.env',
  'rclone.conf',
  '.netrc'
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
