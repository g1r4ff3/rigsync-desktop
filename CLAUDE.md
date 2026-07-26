# rigsync-desktop

Claude Desktop급 머신 설정 동기화 앱. Electron + React + TypeScript 단일 언어.
계획·아키텍처·phase는 `FORWARD.md`가 진실 계층 — 작업 착수 전 읽는다.
구 구현 `~/repos/rigsync`(Python)는 읽기 전용 참고 — 코드 복사 금지, 행동 명세(tests/)만 채굴.

## 안전 불변식 (non-negotiable — 어떤 리팩터에서도 불변)

1. 시스템 변조는 dry-run이 기본. 실제 실행은 명시적 확인 게이트를 통과해야 한다.
2. 파일을 덮어쓰기 전 반드시 `~/.rigsync-backup/<timestamp>/`에 백업.
3. 시크릿 denylist(id_*, *.pem, *token* 등) — capture가 어떤 경로로도 담지 않는다.
4. capture는 additive-only. 항목 제거는 ignore 설정에 의한 것만.
5. 삭제는 **앱이 자발적으로 하지 않는다.** 사용자가 항목별로 명시 선택하고 실행 전 확인한
   경우에만 수행한다 (2026-07-26 사용자 승인으로 개정 — 원 조항은 "삭제는 자동화하지 않는다,
   후보를 보고만 한다"였다. 취지는 "앱이 사용자 모르게 지우지 않는다"이지 "사용자가 승인해도
   못 지운다"가 아니었다). 삭제 경로는 다음을 모두 지킨다:
   - 항상 dry-run 먼저 — 실행될 명령 전문을 노출하고 확인받는다(불변식 ⑥).
   - 일괄 삭제는 대상 전체 목록을 먼저 보여주고, 그 안에서 항목별로 제외할 수 있다.
   - dotfiles 등 파일 삭제는 백업 후 삭제한다(불변식 ②).
   - apt 등 의존성이 있는 패키지는 **함께 제거될 목록을 그대로 노출**하고 경고한다.
     `--auto-remove` 류로 범위를 넓히지 않는다.
6. 권한 상승 전, 실행될 스크립트 전문을 사용자에게 노출한다.
7. follower role에서 capture(저작)는 차단된다 (reference/follower 단방향 배포).

## 아키텍처 규칙

- `src/engine/`은 **UI를 모른다** — Electron·React import 금지, Node API만.
  엔진은 나중에 CLI·데몬이 그대로 재사용할 수 있어야 한다.
- renderer는 렌더만 — 시스템 접근은 전부 `src/shared/`의 타입드 IPC 계약을 거친다
  (`contextBridge`, `nodeIntegration: false`).
- 실행 경로는 이벤트 emit (완료 후 일괄 반환 금지) — UI 실시간 진행의 전제.
- 새 기능의 소속은 DESIGN 3분류(배포 대상/머신 고유/설치 체크리스트)로 판단. 애매하면 사용자에게.

## Design constraints (non-negotiable)

rigsync는 랜딩페이지가 아니라 **계기판**이다. 사용자는 렌더 잡 돌려놓고 힐끗 보고
지나간다. 3초 안에 "이 머신이 기준과 다른가"가 읽혀야 한다.
참조 미학: Linear의 밀도 + btop의 정보 표현. 3-OS 동일 렌더링 — OS 네이티브룩 추종 안 함.

- Font: UI 전역 system-ui, 경로/명령/패키지명은 monospace
- Palette: Research Canvas(`research-workbench-ui`)의 shadcn HSL 토큰 체계 채택
  (2026-07-26 사용자 지시로 5색 고정 조항 폐기). background/foreground/card/popover/
  primary/secondary/muted/accent/destructive/border/input/ring 토큰을 그대로 쓰고,
  light/dark 둘 다 지원하며 OS `prefers-color-scheme`을 따른다(수동 토글 없음).
  primary는 블루. nav glassmorphism 토큰·모바일 전용 토큰은 가져오지 않는다.
- Radius: 단일값 하나(`--radius: 0.5rem`). 다른 값 금지
- Density: 머신 상태가 스크롤 없이 한 화면에
- 상태는 색+형태로 인코딩 (색만으로 구분 금지)
- 컴포넌트는 shadcn/ui에서 가져온다 — 비슷한 걸 손으로 깎지 않는다 (shadcn MCP 사용)
- 금지: 그라데이션, 글래스모피즘, 보라색, 가운데 정렬 히어로, 200px 넘는 빈 여백, 이모지 아이콘

## Explanability contract (non-negotiable — R4, 2026-07-25 사용자 승인)

앱은 개발자가 아닌 사람이 처음 봐도 각 요소의 기능을 알 수 있어야 한다. 어기는 순간 버그로 취급:
근거 원칙은 Nielsen 휴리스틱의 recognition-over-recall / help & documentation / real-world match.
참조 제품: Tailscale(상태를 평문으로), GitHub Desktop(개념을 행동 언어로).

- **언어 정책**: 라벨·버튼·탭 = 영어, 설명·툴팁·헬프·상태 문구 = 한국어.
- **4층 시스템** (전 화면 일관 적용):
  1. Microcopy — 모든 버튼에 한 줄 부제, 모든 섹션에 한 줄 설명. 용어는 상수 파일 한 곳에서 관리.
  2. Tooltip — 모든 인터랙티브 요소에 shadcn Tooltip. 비활성 요소엔 반드시 "왜 비활성인지".
  3. Help — 화면마다 ? 팝오버로 개념 설명 3–5문장 (reference/follower·drift·INV-1 등 내부 개념).
  4. State — 빈 화면·에러는 반드시 다음 행동을 안내한다 ("먼저 Capture를 실행하세요").
- 온보딩 투어는 만들지 않는다 (v1 범위 밖 — 사용자 결정).
- UI 변경 검증은 스크린샷 루프로 한다 (dev 스크린샷 하네스 사용).

## 개발 규율

- 테스트: Vitest. capability 구현 시 구 repo `tests/test_*.py`의 대응 케이스를 옮겨
  행동 동치를 확인한다 (예: dotfiles ← test_dotfiles.py 12케이스).
- UI 변경은 스크린샷 루프로 검증 (텍스트 리뷰만으로 정렬 깨짐 못 잡는다).
- 커밋은 작업 단위로, 사용자 확인 후. `git add -A` 금지 — 명시 경로만.
- 이 파일과 FORWARD.md의 불변식·계약 수정은 사용자 승인 필수.
