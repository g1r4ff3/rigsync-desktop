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
    'INV-1(중복 설치 경고)은 같은 앱이 apt/flatpak/snap/AppImage 중 둘 이상에 설치된 경우를 잡아냅니다.',
    '계층 재분류 감지는 manifest가 기록한 설치 방식과 실제 설치 방식이 어긋난 경우를 보여줍니다.'
  ].join(' '),
  items: [
    'Candidates는 관리 대상(manifest에 있음)과 미관리 후보(설치는 됐지만 기록 안 됨)를 한 목록에 보여줍니다.',
    '스위치는 켜짐 = 동기화 대상에 포함입니다 — 끄면 그 항목을 ignore 처리해 다음 Capture부터 완전히 빼고, diff/Apply 대상에서도 제외합니다.',
    '그룹 헤더의 체크박스는 그룹 전체를 한 번에 동기화 대상/ignore로 맞춥니다 — 일부만 ignore면 대시(-) 표시입니다.',
    'snap 그룹은 "검출 전용"입니다 — INV-1 중복 검출에만 쓰이고 실제 설치/제거는 하지 않습니다(정책상 동기화 대상 아님).'
  ].join(' '),
  doctor: [
    'Doctor는 rigsync가 자동화하지 않는 수동 설치·설정 상태를 점검합니다.',
    '기본 진단은 machine-id/role/manifest 폴더 존재 여부를 보여줍니다.',
    'AppImage preflight는 Gear Lever 설치 여부와 버전, libfuse2t64, AppImageLauncher 충돌 가능성을 확인합니다.',
    'NVIDIA 항목은 커널 드라이버(NVRM)와 설치된 패키지 버전이 다르면 경고합니다 — 대개 재부팅하면 해소됩니다.',
    '체크리스트 항목은 hand-maintained 목록이며 "Dismiss"로 다시 보지 않을 수 있습니다.'
  ].join(' '),
  settings: [
    '여기서 바꾸는 값은 저장 즉시 반영됩니다 — 앱 재시작이 필요 없습니다.',
    'role을 reference에서 follower로 바꾸면 이 머신의 capture가 즉시 차단됩니다.',
    'follower에서 reference로 바꾸면 이 머신이 manifest 저작 권한을 갖게 되어 이후 capture가 자동 commit+push됩니다.',
    'manifest 경로를 바꿔도 기존 데이터는 옮겨지지 않습니다 — 경로 설정만 바뀝니다.',
    'drift 체크 간격을 0으로 두면 트레이 상주 감시가 완전히 꺼집니다.'
  ].join(' '),
  onboarding: [
    '처음 실행할 때 딱 한 번 필요한 설정입니다 — Settings 화면에서 나중에 다시 바꿀 수 있습니다.',
    '머신 이름은 이 머신을 구별하는 고유 식별자입니다 — hostname을 그대로 쓰면 여러 머신이 같은 이름이 될 수 있습니다.',
    'reference는 이 머신에서 저작(capture)하고, follower는 다른 머신이 저작한 내용을 받기만 합니다.',
    'manifest 저장소는 여러 머신이 공유하는 설정 저장소입니다 — 새로 만들거나 기존 경로를 지정할 수 있습니다.'
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

export const errorGuidanceCopy = {
  generic: '문제가 반복되면 Doctor 탭에서 기본 진단을 먼저 확인하세요.',
  syncError:
    '동기화 오류입니다 — Settings에서 manifest 경로를 확인하거나 수동으로 git 상태를 점검하세요.'
} as const
