/**
 * refactor-spec-v0.2 F5 — 레지스트리 미등록 항목의 버전성 파일명 탐지.
 *
 * fonts/binaries capture는 둘 다 같은 문제 구조를 공유한다(fonts/diff.ts 주석
 * 참조): 알려진 레지스트리에 없는(소스 미지정) 파일은 정확한 파일명 일치로만
 * 비교되므로, 파일명 자체에 버전이 박혀 있으면(예: `JetBrainsMono-2.304.ttf`)
 * 머신마다 실제로 받는 릴리스 버전이 달라 파일명이 절대 일치하지 않는다 —
 * "영원히 불일치"하는 함정이다. 소스를 지정해 레지스트리에 등록하기 전까지는
 * 구조적으로 해소되지 않으므로, capture/doctor 시점에 미리 경고한다.
 *
 * 패턴은 스펙에 명시된 `-\d+\.\d+`(하이픈 뒤 `숫자.숫자`) 그대로다 — 예:
 * `JetBrainsMono-2.304.ttf`, `uv-0.5.1.tar.gz`. 필요 이상으로 넓히면 오탐이
 * 늘어나므로(예: 순수 소수점 없는 버전, 언더스코어 구분자 등) 스펙이 명시한
 * 범위만 다루고, 실측으로 놓치는 사례가 나오면 그때 보수적으로 확장한다.
 */
const VERSIONED_FILENAME_RE = /-\d+\.\d+/

export function isVersionedFilename(name: string): boolean {
  return VERSIONED_FILENAME_RE.test(name)
}

export const VERSIONED_FILENAME_WARNING =
  '소스 미지정 + 버전성 파일명 — 다른 머신에서 수렴하지 않을 수 있음'
