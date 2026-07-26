import type { EngineRole, SyncItemState } from '../../shared/ipc'

/**
 * Microcopy 상수 — CLAUDE.md Explanability contract ①. 라벨/버튼/탭은 영어,
 * 설명·툴팁·헬프·상태 문구는 한국어(계약의 언어 정책). 새 화면을 추가하거나
 * 문구를 바꿀 때 이 파일 하나만 고치면 된다 — 컴포넌트에 직접 문자열을
 * 박지 않는다.
 */

export const tabCopy = {
  diff: { label: 'Differences', subtitle: '이 머신과 manifest를 비교' },
  items: { label: 'Candidates', subtitle: '동기화할 항목 선택' },
  doctor: { label: 'Doctor', subtitle: '수동 점검 체크리스트' },
  settings: { label: 'Settings', subtitle: '머신 이름·역할·저장 위치' }
} as const

/**
 * R8 (Candidates 화면 explainability 재작업 — 실사용 실패 수정): 이 화면이
 * "무엇인지"를 화면 자체가 먼저 말하지 않아서 생긴 오독을 고친다. 실사용
 * 사례 — follower 머신에서 "추가 예정 99"를 본 사용자가 "밀린 동기화
 * 작업"으로 읽었다("연구실 컴퓨터에 없는 항목들이란 거잖아"라는 실제 뜻을
 * 화면만 보고는 전혀 짐작 못 함). 목록 자체의 정의(이 머신에 있는 것 중
 * manifest에 있는/없는 것)를 role과 무관하게 먼저 밝히고, "안 들어있는 항목"이
 * 실제로 어떻게 되는지만 role별로 갈라 말한다 — reference는 이 머신에서 바로
 * Capture할 수 있고, follower는 그럴 수 없어 reference에서 해야 한다.
 */
export const candidatesIntroCopy = {
  reference:
    '이 머신에 설치·존재하는 항목을 모아, manifest(동기화 기준)에 이미 들어있는 것과 아직 안 들어있는 것을 보여줍니다 — 아직 안 들어있는 항목은 Capture하면 manifest에 추가됩니다.',
  follower:
    '이 머신에 설치·존재하는 항목을 모아, manifest(동기화 기준)에 이미 들어있는 것과 아직 안 들어있는 것을 보여줍니다 — 아직 안 들어있는 항목은 이 머신에만 있는 것이며, follower는 Capture할 수 없어 manifest에 넣으려면 reference 머신에서 해야 합니다.'
} as const

/**
 * R5: Differences 요약 카드의 role별 프레이밍 — Explanability 계약 "real-world
 * match" 위반 수정. reference 머신은 그 자체가 기준이라 "이 머신이 기준과
 * 다른 점"이라는 문구가 성립하지 않는다(자신과 자신을 비교하는 꼴). reference의
 * Differences는 실제로는 "Capture로 manifest에는 기록됐지만 아직 이 머신에
 * 반영(심링크 전환·설치 등)은 안 된 항목"을 보여준다 — Apply가 그 반영을
 * 수행한다. follower는 기존 프레이밍("기준과 다름")이 여전히 맞다(단방향
 * 배포 대상이므로 실제로 기준 대비 차이를 보고하는 게 맞음).
 */
export const diffSummaryCopy = {
  reference: {
    heading: '아직 이 머신에 반영되지 않은 항목',
    drift: '건 — Apply로 반영할 수 있습니다',
    matched: '모두 반영됨',
    /** capability별 칩 툴팁의 짧은 단위 표현. */
    chipUnit: '건 미반영'
  },
  follower: {
    heading: '이 머신이 기준과 다른 점',
    drift: '건 — Apply로 맞출 수 있습니다',
    matched: '기준과 일치',
    chipUnit: '건 드리프트'
  }
} as const

/**
 * R6 R1: Candidates 4상태 모델(managed × ignored) — 라벨은 화면(아이콘·집계·
 * 배지)에서, description은 항목 행의 상태 아이콘 툴팁에서 쓴다. 실제 동작
 * 확인 결과(ignore.ts): ignore 토글은 manifest를 즉시 안 바꾸고 common
 * ignore.toml만 갱신한다 -- 실제 반영(추가/제거)은 다음 Capture 때 일어난다.
 *
 * R8: 이 기본값은 **reference 프레이밍**이다(Capture가 실제로 이 머신에서
 * 실행 가능한 동작이므로 "다음 Capture가 ~" 문장이 참). follower에서는
 * `describeSyncItemState`가 role을 보고 대신 갈아 끼운다 — 아래 그 함수의
 * 주석 참조(실사용 실패의 핵심 원인이 이 문구였다).
 */
export const syncItemStateCopy = {
  synced: {
    label: '동기화 중',
    description: '지금 manifest에 포함되어 있어 Apply 때 이 머신에 반영됩니다.'
  },
  'pending-add': {
    label: '추가 예정',
    description: '이 머신에는 있지만 아직 manifest엔 없습니다 — Capture하면 새로 추가됩니다.'
  },
  'pending-remove': {
    label: '제거 예정',
    description: '지금은 manifest에 있지만 ignore 처리돼 있어 Capture하면 제거됩니다.'
  },
  excluded: {
    label: '제외됨',
    description: 'ignore 처리되어 있어 Capture해도 다시 담기지 않습니다.'
  },
  /**
   * R7: detection-only 그룹(snap) 전용 상태 — 코디네이터가 스크린샷에서 발견한
   * 자기모순("검출 전용" 그룹인데 "추가 예정"이라 표시) 수정. snap은 plan/apply
   * 대상이 아니므로(FORWARD.md §7) 다른 네 상태처럼 "다음 Capture가 어떻게
   * 바꿀지"를 말하지 않고, 그냥 이 머신에 있다는 사실만 말한다.
   */
  detected: {
    label: '검출됨',
    description:
      '이 머신에서 발견됐습니다 — snap은 동기화 대상이 아니라 중복 설치 검출(INV-1)에만 쓰입니다.'
  }
} as const

/**
 * R8: role을 아는 상태 설명 — 실사용 실패("follower에서 '추가 예정 99'를
 * 밀린 동기화 작업으로 오독") 재발 방지. follower는 Capture를 실행할 수 없는데
 * (안전 불변식 ⑦) 위 기본 문구는 전부 "Capture하면 ~"라고 말해 "내가 뭘 해야
 * 한다"는 오독을 부른다. 특히 `pending-add`는 라벨 자체를 바꾼다 — "추가
 * 예정"은 이 머신이 뭔가를 곧 할 것처럼 들리는데, follower는 애초에 추가할
 * 수 없다(real-world match 위반). "이 머신에만 있음"으로 바꾸면 사용자가
 * 실제로 물었던 질문("연구실 컴퓨터에 없는 항목들이란 거잖아")에 화면이 직접
 * 답한다. pending-remove/excluded는 사실관계 자체는 role과 무관하게 참이라
 * 라벨은 그대로 두고, 주어만 "Capture" → "reference에서 Capture"로 바꿔
 * "내가 할 일"이 아님을 분명히 한다.
 */
export function describeSyncItemState(
  state: SyncItemState,
  role: EngineRole | undefined
): { readonly label: string; readonly description: string } {
  if (role !== 'follower') return syncItemStateCopy[state]
  if (state === 'pending-add') {
    return {
      label: '이 머신에만 있음',
      description:
        '이 머신에서 발견됐지만 manifest(동기화 기준)엔 없습니다 — 기준에 넣으려면 reference 머신에서 Capture해야 합니다.'
    }
  }
  if (state === 'pending-remove') {
    return {
      label: syncItemStateCopy['pending-remove'].label,
      description:
        '지금은 manifest에 있지만 ignore 처리돼 있어 reference에서 Capture하면 제거됩니다.'
    }
  }
  if (state === 'excluded') {
    return {
      label: syncItemStateCopy.excluded.label,
      description: 'ignore 처리되어 있어 reference가 Capture해도 다시 담기지 않습니다.'
    }
  }
  return syncItemStateCopy[state]
}

/**
 * R6 R1: Candidates 화면 상단/그룹 헤더 집계 한 줄 — 0건인 상태는 생략해 잡음을 줄인다.
 * R8: `pending-add`의 라벨은 role에 따라 달라지므로(위 `describeSyncItemState`
 * 참조) 집계 문구도 같은 함수로 라벨을 얻어 일관되게 맞춘다 — 그렇지 않으면
 * follower가 항목 목록에선 "이 머신에만 있음"을 보고 바로 위 집계 줄에선
 * "추가 예정"을 보는 모순이 생긴다.
 */
export function formatSyncItemStateSummary(
  counts: {
    readonly synced: number
    readonly pendingAdd: number
    readonly pendingRemove: number
    readonly excluded: number
  },
  role: EngineRole | undefined
): string {
  const parts: string[] = []
  if (counts.synced > 0) parts.push(`${syncItemStateCopy.synced.label} ${counts.synced}`)
  if (counts.pendingAdd > 0) {
    parts.push(`${describeSyncItemState('pending-add', role).label} ${counts.pendingAdd}`)
  }
  if (counts.pendingRemove > 0) {
    parts.push(`${syncItemStateCopy['pending-remove'].label} ${counts.pendingRemove}`)
  }
  if (counts.excluded > 0) parts.push(`${syncItemStateCopy.excluded.label} ${counts.excluded}`)
  return parts.join(' · ')
}

/**
 * R7: detection-only 그룹(snap) 헤더 집계 — 4상태 요약과 다른 문구를 쓴다
 * ("추가 예정 N"이 아니라 "검출됨 N"). 그룹 전체가 항상 `detected` 상태뿐이라
 * 카운트 하나면 충분하다.
 */
export function formatDetectionOnlySummary(count: number): string {
  return `${syncItemStateCopy.detected.label} ${count}`
}

/**
 * R7: detection-only 그룹(snap)의 스위치·그룹 체크박스가 비활성인 이유.
 * 코드로 확인한 실제 동작: ignore 토글은 `[snap] packages` ignore.toml만
 * 갱신하는데, 이 값을 읽는 곳은 captureSnap/diffSnap뿐이고 diffSnap 결과는
 * 어느 화면에도 안 보이며(DiffView가 의도적으로 숨김), planPackages는
 * planSnap을 호출하지 않는다(plan.ts) — 그리고 INV-1 중복 검출(duplicates.ts)은
 * 아예 다른 ignore 네임스페이스(`duplicates`/`names`)를 쓴다. 즉 이 화면에서
 * 스위치를 눌러도 사용자가 관찰 가능한 결과가 전혀 없다 — 그래서 끄지 않고
 * 비활성화한다(Explanability 계약 ②: 비활성 요소엔 반드시 이유).
 */
export const detectionOnlyDisabledReason =
  'snap은 동기화 대상이 아닙니다 — 중복 설치 검출에만 사용합니다.'

/**
 * R8: follower에서 ignore 스위치·그룹 체크박스를 비활성화하는 이유 — 실사용
 * 실패 수정 3번("역할별로 정직하게")의 핵심. 코드로 직접 재현해 확인한 실제
 * 동작(git 작업 트리 실험, `ignore.ts` setIgnoredBulk가 common/ignore.toml에
 * 즉시 쓰는 경로를 그대로 따라감):
 * - follower는 capture가 막혀 있어(안전 불변식 ⑦) 이 쓰기가 절대 커밋되지
 *   않는다 — manifest 저장소 작업 트리에 커밋되지 않은 변경으로만 남는다.
 * - reference가 나중에 같은 파일(common/ignore.toml)을 건드리는 커밋을
 *   push하면, 이 머신의 다음 `git pull --ff-only`가 그 파일의 로컬 미커밋
 *   변경과 충돌해 **통째로 실패**한다("Your local changes... would be
 *   overwritten by merge" — 실제 재현 확인). 즉 사소한 토글 하나가 이 머신
 *   전체 동기화를 막아버릴 수 있다.
 * - 그렇지 않은 경우엔 그냥 무기한 로컬 미커밋 상태로 남아 아무 효과가 없다.
 * 두 경우 다 "의미 있는 효과"가 없거나 위험만 만드므로 비활성화한다.
 */
export const followerToggleDisabledReason =
  'follower에서는 저장되지 않습니다 — 이 머신에서 바꿔도 반영되지 않고 그대로 남거나, reference가 나중에 같은 항목을 바꾸면 이 머신의 다음 동기화가 막힐 수 있습니다. reference 머신에서 바꾸세요.'

/** R8: follower에서는 ignore 토글이 전부 비활성이다(위 followerToggleDisabledReason). */
export function isFollowerToggleDisabled(role: EngineRole | undefined): boolean {
  return role === 'follower'
}

/**
 * R8: ignore 스위치·그룹 체크박스의 비활성 사유를 우선순위대로 고른다 —
 * SyncItemsView의 GroupCheckbox·Switch 두 곳에서 똑같은 분기가 중복돼 있던
 * 것을 여기 하나로 모았다(순서 규칙: 그룹이 detectionOnly면 그 사유가 더
 * 구체적이므로 우선, 아니면 follower 사유, 둘 다 아니면 비활성 아님).
 */
export function toggleDisabledReason(
  detectionOnly: boolean,
  role: EngineRole | undefined
): string | undefined {
  if (detectionOnly) return detectionOnlyDisabledReason
  if (isFollowerToggleDisabled(role)) return followerToggleDisabledReason
  return undefined
}

/**
 * R6 R1: 보류 중 변경(추가/제거 예정) 배너 — State 층 "다음 행동 안내".
 * R8: follower는 이 배너를 아예 띄우지 않는다 — capture가 불가능한 머신에
 * "Capture를 실행하세요"라고 지시하는 건 불가능한 행동 지시(실사용 실패
 * 2번: 사용자가 지시대로 눌렀지만 follower라 차단돼 아무 일도 안 일어났다).
 * 다른 문구로 대체하는 대신 화면 상단의 `candidatesIntroCopy.follower` +
 * 항목별 role-aware 상태 설명이 그 역할을 대신한다(중복 정보를 늘리지 않는다).
 */
export function shouldShowPendingCaptureBanner(
  pendingCount: number,
  role: EngineRole | undefined
): boolean {
  return pendingCount > 0 && role !== 'follower'
}

export const pendingChangesCopy = {
  bannerText: (count: number): string =>
    `보류 중인 변경 ${count}건 — 반영하려면 Capture를 실행하세요.`,
  captureSubtitle: '보류 중인 변경을 지금 manifest에 반영합니다'
} as const

export const buttonCopy = {
  capture: { label: 'Capture', subtitle: '지금 상태를 manifest로 기록' },
  captureDisabledFollower: 'follower는 capture 불가 — reference에서만 저작합니다',
  apply: { label: 'Apply', subtitle: '계획대로 이 머신을 맞춤' },
  applyDisabledNoDrift: '기준과 이미 일치 — 적용할 변경이 없습니다',
  applyConfirm: { label: 'Confirm & Run', subtitle: '위 스크립트를 실제로 실행' },
  applyCancel: { label: 'Cancel', subtitle: '진행 중인 실행을 중단' },
  applyClose: { label: 'Close', subtitle: '결과를 닫고 목록으로' },
  refresh: { label: 'Recheck', subtitle: '지금 다시 점검' },
  ignoreCheck: { label: 'Dismiss', subtitle: '이 점검을 다시 보지 않음' },
  saveSettings: { label: 'Save', subtitle: '변경 사항을 config.toml에 저장' },
  saveSettingsDisabled: '머신 이름과 저장 경로는 비워둘 수 없습니다',
  completeOnboarding: { label: 'Finish setup', subtitle: '설정을 마치고 메인 화면으로' },
  completeOnboardingDisabledClone: 'repository URL과 저장 경로를 모두 입력해야 클론할 수 있습니다',
  cloneManifestRepo: { label: 'Clone', subtitle: '지정한 저장소를 이 경로로 클론' },
  cloneManifestRepoDisabled: 'repository URL과 저장 경로를 모두 입력해야 클론할 수 있습니다',
  // R4 스크린샷 자기검수에서 발견: 버튼이 busy(진행 중) 때문에 비활성화됐는데도
  // ActionButton이 항상 domain별 disabledReason(예: "follower는 capture 불가")을
  // 보여줘 실제 비활성 사유와 다른 설명이 뜨는 문제가 있었다 — busy는 이 공용
  // 문구로 우선 표시한다(Explanability 계약 ②: "왜 비활성인지"가 틀리면 안 됨).
  busyReason: '처리 중입니다…'
} as const

export const sectionCopy = {
  dotfiles: '심링크/복사로 관리하는 개인 설정 파일 (예: .zshrc, .gitconfig)',
  packages: 'apt로 설치된 패키지와 서명 소스',
  appimage: 'Gear Lever로 통합 관리하는 AppImage',
  fonts:
    '수동 설치한 폰트 파일(예: Powerlevel10k·D2Coding) — 좌표만 동기화, 바이너리는 apply 때 다운로드',
  binaries:
    '`curl | sh`로 ~/.local/bin에 설치한 단독 실행파일(예: uv·micromamba) — 좌표만 동기화, 실행파일은 apply 때 다운로드',
  settings: 'dconf(GNOME 등 데스크톱 설정) 감시 경로',
  services: 'systemd --user 유닛 파일',
  scheduled: '사용자 crontab 전체',
  tools: 'nvm으로 관리하는 Node 버전 + 전역 npm 패키지',
  repos: 'git clone으로 관리하는 로컬 저장소',
  duplicates: '같은 앱이 여러 설치 방식에 중복 등록된 경우(INV-1)',
  reclassifications: 'manifest에 기록된 설치 방식과 실제 설치 방식이 다른 항목'
} as const

/**
 * R5: dotfiles 세부 항목의 내부 상태 태그(`toLink`/`contentChanged`/
 * `missingHome`/`invalidStore`)를 사람이 읽는 문장으로 바꾼다 — 이전에는
 * `[to-link]` 같은 raw 태그가 그대로 노출돼(예: reference 머신에서 방금
 * Capture한 직후에도 "[to-link] ~/.zshrc"가 떠 "왜 벌써 어긋났지?"로 오독됐다)
 * Explanability 계약(real-world match)을 어겼다. 경로 자체는 여전히 monospace로
 * 별도 표시하고(DiffView가 처리), 여기는 상태를 설명하는 문장만 담당한다.
 */
export const dotfilesStateCopy = {
  toLink: '스토어로 연결 필요 (최초 1회 — Apply가 백업 후 심링크로 전환)',
  contentChanged: '스토어와 내용이 다름 (Apply로 갱신)',
  missingHome: '홈에 파일이 없음 (Apply로 생성)',
  invalidStore: '스토어 경로가 잘못됨 — manifest 확인 필요'
} as const

/** dotfiles의 to-link 상태가 왜 생기는지 요약 카드/섹션에 붙이는 한 줄 설명. */
export const dotfilesToLinkExplainCopy =
  'Capture는 홈 파일을 스토어로 복사만 합니다 — 홈 파일을 스토어 심링크로 바꾸는 것은 Apply의 몫입니다.'

export const helpCopy = {
  diff: [
    'Differences는 이 머신의 실제 상태와 manifest(선언된 기준)를 비교합니다.',
    'reference 머신은 Capture로 현재 상태를 manifest에 기록하고 자동으로 commit+push합니다 — 그래서 reference의 요약은 "기준과 다른 점"이 아니라 "아직 이 머신에 반영되지 않은 항목"으로 표시됩니다.',
    'follower 머신은 저작할 수 없고 pull로 받은 manifest를 Apply로 반영만 합니다(단방향 배포) — follower의 요약은 실제로 기준과 다른 점을 보여줍니다.',
    'dotfiles는 Capture 직후에도 "스토어로 연결 필요"로 남을 수 있습니다 — Capture는 홈 파일을 스토어로 복사만 하고, 홈 파일을 스토어 심링크로 바꾸는 것은 Apply의 몫이기 때문입니다(최초 1회만 있는 정상 상태 — 이후엔 심링크라 홈을 고치면 스토어도 곧바로 바뀝니다).',
    'Fonts는 폰트 파일 자체가 아니라 다운로드 좌표(직접 URL 또는 GitHub 릴리스)만 manifest에 담습니다 — Apply 때 이 좌표로 실제 파일을 받아 설치합니다.',
    'Binaries는 `curl | sh`로 ~/.local/bin에 떨어지는 단독 실행파일(uv·micromamba 등)을 다룹니다 — 실행파일 자체가 아니라 GitHub 릴리스 좌표만 manifest에 담고, conda/micromamba 환경(~/micromamba/envs/** 등) 안의 도구는 그 환경의 스펙이 책임지므로 스캔 대상이 아닙니다.',
    'INV-1(중복 설치 경고)은 같은 앱이 apt/flatpak/snap/AppImage 중 둘 이상에 설치된 경우를 잡아냅니다.',
    '계층 재분류 감지는 manifest가 기록한 설치 방식과 실제 설치 방식이 어긋난 경우를 보여줍니다.'
  ].join(' '),
  items: [
    'Candidates는 이 머신에 설치·존재하는 항목을 provider(apt/flatpak/appimage/fonts/binaries/dotfiles/tools/repos)별로 모아, manifest(동기화 기준)에 이미 들어있는(managed) 항목과 아직 안 들어있는(unmanaged) 항목을 함께 보여줍니다.',
    '각 항목은 4가지 상태 중 하나입니다: 동기화 중(manifest에 있고 계속 유지)/추가 예정(이 머신엔 있지만 manifest엔 아직 없음 — reference에서 Capture하면 추가됨)/제거 예정(지금은 manifest에 있지만 ignore돼 있어 Capture하면 빠짐)/제외됨(ignore돼 안정적으로 빠진 상태). follower 머신에서는 "추가 예정"이 "이 머신에만 있음"으로 표시됩니다 — follower는 Capture를 할 수 없어 "예정"이라는 말 자체가 성립하지 않고, 실제로는 "reference의 manifest엔 없는, 이 머신만의 항목"이라는 뜻이기 때문입니다.',
    '스위치는 켜짐 = 동기화 대상에 포함입니다 — 끄면 ignore 처리하지만, manifest 반영(추가/제거)은 그 자리에서 즉시 일어나지 않고 reference의 다음 Capture 때 일어납니다 — 그래서 reference 머신에서 보류 중 변경이 있으면 배너로 Capture를 안내합니다.',
    'follower 머신에서는 이 스위치·그룹 체크박스가 모두 비활성화되어 있습니다 — follower는 capture가 막혀 있어 이 화면에서 바꾼 값이 다시 커밋되지 않고, 이 머신에만 남아 효과가 없거나 reference가 나중에 같은 항목을 바꾸면 오히려 이 머신의 다음 동기화를 막을 수 있기 때문입니다. 바꾸려면 reference 머신에서 하세요.',
    '그룹 헤더와 화면 상단의 집계(동기화 중/추가 예정 또는 이 머신에만 있음/제거 예정/제외)는 검색 필터와 무관하게 항상 그룹·전체 전부를 센 값입니다.',
    '항목 옆 설명은 apt(Description-en)/flatpak(이름+설명)/appimage(Gear Lever 이름)/fonts(설치된 파일 수)/binaries(설치된 실행파일 이름)/dotfiles(잘 알려진 경로)/repos(remote URL) 등 시스템에서 조회한 것입니다 — 출처가 없으면 설명 없이 이름/경로만 보여줍니다.',
    '그룹 헤더의 체크박스는 그룹 전체를 한 번에 동기화 대상/ignore로 맞춥니다 — 일부만 ignore면 대시(-) 표시입니다(follower에서는 비활성화).',
    'snap 그룹은 "검출 전용"입니다 — INV-1 중복 검출에만 쓰이고 실제 설치/제거는 하지 않습니다(정책상 동기화 대상 아님). 그래서 4상태 대신 "검출됨" 하나로만 표시되고, 스위치도 비활성화되어 있습니다(눌러도 동기화 결과에 아무 영향이 없기 때문).'
  ].join(' '),
  doctor: [
    'Doctor는 rigsync가 자동화하지 않는 수동 설치·설정 상태를 점검합니다.',
    '기본 진단은 machine-id/role/manifest 폴더 존재 여부를 보여줍니다.',
    'follower인데 manifest에 선언된 항목이 없거나 원격 저장소가 연결돼 있지 않으면 경고합니다 — follower는 기준 저장소를 클론해서 시작해야 하는데 그 경로 없이 시작되면 사고이기 때문입니다(reference의 빈 manifest는 첫 capture 전이라 정상입니다).',
    'AppImage preflight는 Gear Lever 설치 여부와 버전, libfuse2t64, AppImageLauncher 충돌 가능성을 확인합니다.',
    'Fonts 점검은 manifest에 선언됐지만 이 머신에 없는 폰트, 설치는 됐지만 소스가 알려지지 않아 재현 불가능한 폰트, fc-cache/fc-list 사용 가능 여부를 확인합니다.',
    'NVIDIA 항목은 커널 드라이버(NVRM)와 설치된 패키지 버전이 다르면 경고합니다 — 대개 재부팅하면 해소됩니다.',
    'Secret scan은 manifest 저장소 전체를 다시 훑어 GitHub 토큰 등 비밀로 보이는 값이 남아있는지 확인합니다 — Capture 시점에 이미 한 번 걸러졌어야 할 것들이 어떤 경로로든 남아있는지 잡는 마지막 안전망입니다.',
    'Auto-update(self)는 AppImage로 실행 중일 때만 나타납니다 — rigsync 자신이 Gear Lever의 자동 업데이트 소스로 지정돼 있는지를 봅니다. 앱이 시작할 때 한 번 스스로 등록을 시도하지만(실패해도 반복하지 않습니다), 그마저 안 됐다면 여기에 직접 실행할 수 있는 명령 전문이 표시됩니다.',
    '체크리스트 항목은 hand-maintained 목록이며 "Dismiss"로 다시 보지 않을 수 있습니다.'
  ].join(' '),
  settings: [
    '여기서 바꾸는 값은 저장 즉시 반영됩니다 — 앱 재시작이 필요 없습니다.',
    'role을 reference에서 follower로 바꾸면 이 머신의 capture가 즉시 차단됩니다.',
    'follower에서 reference로 바꾸면 이 머신이 manifest 저작 권한을 갖게 되어 이후 capture가 자동 commit+push됩니다.',
    'manifest 경로를 바꿔도 기존 데이터는 옮겨지지 않습니다 — 경로 설정만 바뀝니다.',
    'drift 체크 간격을 0으로 두면 트레이 상주 감시가 완전히 꺼집니다.',
    '"Clone from repository"는 온보딩을 다시 하지 않고도 manifest 저장소를 새로 클론해 이 머신을 연결합니다 — follower가 빈 로컬 저장소로 잘못 시작됐을 때 복구하는 용도입니다.'
  ].join(' '),
  onboarding: [
    '처음 실행할 때 딱 한 번 필요한 설정입니다 — Settings 화면에서 나중에 다시 바꿀 수 있습니다.',
    '머신 이름은 이 머신을 구별하는 고유 식별자입니다 — hostname을 그대로 쓰면 여러 머신이 같은 이름이 될 수 있습니다.',
    'reference는 이 머신에서 저작(capture)하고, follower는 다른 머신이 저작한 내용을 받기만 합니다.',
    'manifest 저장소는 여러 머신이 공유하는 설정 저장소입니다 — 새로 만들거나(reference의 첫 시작), 기존 경로를 지정하거나, 저장소에서 클론할 수 있습니다.',
    'follower의 정상적인 시작 방법은 "저장소에서 클론"입니다 — 기준(reference) 머신이 이미 commit+push해 둔 manifest를 그대로 받아옵니다. "새로 만들기"로 시작하면 빈 로컬 저장소가 되어 다른 머신과 동기화되지 않습니다.'
  ].join(' '),
  applyDialog: [
    '아래는 Apply가 실제로 실행할 명령 전문입니다 — 실행 전에 항상 그대로 보여줍니다(안전 불변식 ⑥).',
    '관리자 권한이 필요한 항목은 한 번의 시스템 인증(polkit)으로 스크립트 하나가 실행됩니다.',
    '실행 전에는 무엇이든 취소할 수 있고, 실행 중에도 남은 항목은 취소할 수 있습니다(이미 시작된 항목은 끝까지 완료).'
  ].join(' ')
} as const

/**
 * R5 라운드5 — Doctor 재설계. 이전엔 탭 바로 아래 "Recheck" 버튼만 덜렁 있어
 * (열자마자 이미 점검이 실행되는데) "무엇을 다시 하는지" 알 수 없었다.
 * 요약(통과/경고/실패 건수)과 "마지막 점검 시각"을 먼저 보여주고 그 옆에
 * Recheck을 두어 "이 시각 이후로 다시 점검"이라는 뜻이 스스로 드러나게 한다.
 */
export const doctorCopy = {
  summaryOk: '통과',
  summaryWarn: '경고',
  summaryError: '실패',
  lastChecked: '마지막 점검',
  lastCheckedNever: '아직 점검 전',
  actionPrefix: '조치',
  allPassed: '통과 — 펼쳐서 세부 항목 보기'
} as const

export const emptyStateCopy = {
  noDrift: '기준과 일치 — 지금은 실행할 Apply 항목이 없습니다.',
  noCandidates: '동기화 대상 항목이 없습니다. Differences 탭에서 먼저 Capture를 실행하세요.',
  noSearchResults: '검색 결과 없음 — 검색어를 지우면 전체 목록이 다시 보입니다.',
  noChecks:
    '사용자 정의 점검이 없습니다 — manifest의 checks.toml에 점검 항목(파일 존재·명령 존재 등)을 추가하면 여기 표시됩니다.',
  loading: '불러오는 중…'
} as const

/**
 * 항목 삭제(uninstall, 안전 불변식 5) — Candidates 화면 3상태 컨트롤(Sync/
 * Pause/Delete)과 삭제 확인/일괄 삭제 다이얼로그의 문구. 라벨은 영어(사용자
 * 지시 — "삭제"가 화면에서 분명히 읽혀야 하므로 Delete 그대로), 설명·툴팁은
 * 한국어(Explanability 계약 언어 정책).
 */
export const candidateControlCopy = {
  sync: { label: 'Sync', tooltip: '동기화 대상에 포함 — 계속 manifest에 유지합니다.' },
  pause: {
    label: 'Pause',
    tooltip: '일시중지(ignore) — 다음 Capture 때 manifest에서 제외되거나 추가되지 않습니다.'
  },
  delete: {
    label: 'Delete',
    tooltip:
      '이 머신에서 실제로 제거합니다 — 실행 전 항상 확인 화면에서 명령 전문을 보여줍니다(1회성 행동, 취소하면 아무 일도 일어나지 않습니다).'
  }
} as const

/**
 * 삭제가 불가능한 항목의 사유 — computeDeleteEligibility(deleteEligibility.ts)가
 * 고른다. 엔진의 excluded 사유(짧은 기계적 문장)를 그대로 노출하지 않고
 * 사용자 말로 옮긴다(코디네이터 지시).
 */
export const deleteDisabledReasonCopy = {
  detectionOnly: 'snap은 삭제 대상이 아닙니다 — 중복 설치 검출에만 사용합니다.',
  unsupportedCapability: (capability: string): string =>
    `${capability} 항목은 아직 삭제를 지원하지 않습니다.`,
  stillManaged:
    '아직 manifest에 있는(동기화 중인) 항목입니다 — 먼저 Pause로 전환한 뒤 Capture로 manifest에서 빠져야 삭제할 수 있습니다.',
  notPaused: '아직 일시중지(Pause)되지 않았습니다 — 먼저 Pause로 전환하세요.'
} as const

/**
 * R8 비대칭 안내: follower에서는 Sync/Pause가 비활성화되지만(직전 pull 파손
 * 위험 — followerToggleDisabledReason) Delete는 이 머신의 로컬 시스템 변경일
 * 뿐이라 role 가드 대상이 아니다. 이 비대칭이 실수로 보일 수 있어 별도로
 * 설명한다.
 */
export const followerDeleteAsymmetryCopy =
  'follower에서도 Delete는 사용할 수 있습니다 — 삭제는 이 머신의 로컬 시스템 변경일 뿐 git으로 동기화되는 내용이 아니기 때문입니다. 반면 Sync/Pause는 계속 비활성화되어 있습니다(위 사유 — 직전 pull이 깨질 위험).'

/** 일괄 삭제 툴바 버튼 — "일시중지 + 설치됨" 항목이 하나 이상일 때만 노출된다. */
export const bulkDeleteCopy = {
  toolbarButton: {
    label: 'Delete selected…',
    subtitle: '일시중지되고 이 머신에 설치된 항목을 모아 한 번에 삭제'
  },
  dialogTitle: 'Select items to delete',
  dialogDescription: (count: number): string =>
    `일시중지되고 이 머신에 설치된 항목 ${count}개 중 삭제할 항목을 고르세요 — 기본은 전체 선택이며, 체크를 해제하면 대상에서 빠집니다.`,
  searchPlaceholder: 'Search…',
  selectedCountSuffix: '개 선택됨',
  continueButton: {
    label: 'Continue',
    subtitle: '선택한 항목으로 삭제 확인 화면으로 이동합니다'
  },
  continueDisabledEmpty: '선택된 항목이 없습니다',
  cancelButton: { label: 'Cancel', subtitle: '아무것도 선택하지 않고 닫습니다' }
} as const

/** 삭제 확인 다이얼로그(단건·일괄 공용) — Apply 확인 다이얼로그와 같은 패턴을 재사용한다. */
export const deleteConfirmCopy = {
  title: (count: number): string => (count === 1 ? 'Delete item' : `Delete ${count} items`),
  description:
    '아래는 실제로 실행할 명령 전문입니다 — 실행 전에 항상 그대로 보여줍니다(안전 불변식 5). 확인하면 되돌릴 수 없습니다.',
  dependencyWarningTitle: '함께 제거될 패키지 (요청하지 않았지만 의존성 때문에 제거됨)',
  excludedTitle: '제외된 항목과 이유',
  confirmButton: { label: 'Delete', subtitle: '위 명령을 실제로 실행합니다 — 되돌릴 수 없습니다' },
  cancelButton: { label: 'Cancel', subtitle: '아무것도 삭제하지 않고 닫습니다(선택은 원래대로)' },
  closeButton: { label: 'Close', subtitle: '결과를 닫고 목록으로 돌아갑니다' },
  runningLabel: '삭제 중…',
  doneLabel: '완료됨',
  doneSummary: (ok: number, failed: number): string =>
    failed > 0 ? `${ok}개 삭제됨, ${failed}개 실패` : `${ok}개 삭제됨`,
  loadingPreview: '삭제 계획을 계산하는 중…',
  noValidTargets: '삭제 가능한 항목이 없습니다 — 아래 제외된 항목과 이유를 확인하세요.'
} as const

export const errorGuidanceCopy = {
  generic: '문제가 반복되면 Doctor 탭에서 기본 진단을 먼저 확인하세요.',
  syncError:
    '동기화 오류입니다 — Settings에서 manifest 경로를 확인하거나 수동으로 git 상태를 점검하세요.'
} as const
