# rigsync-desktop — 그린필드 forward plan

> 작성 2026-07-25. 구 계획(`rigsync-electron-forward-plan.md`, Python 코어 유지 + UI 이식)을
> **대체**한다. 사용자 결정: 이전 구현체는 핵심 아이디어(머신 동기화 앱)만 참고, Claude Desktop처럼
> 새로 만든다. 구 repo `~/repos/rigsync`는 코드 승계 대상이 아니라 **행동 명세의 광산 + 현역 fallback**이다.

---

## 0. 확정 사항 (2026-07-25 사용자 승인)

| 항목 | 결정 |
|---|---|
| 제품 형태 | **앱이 본체.** 설치형 Electron 데스크탑 앱, 터미널 없이 완결. CLI는 나중에 필요하면 엔진 위 얇은 래퍼 |
| 상주 | **트레이 상주 승인** — 주기적 drift 체크 → 알림 → 클릭하면 diff. "생각날 때 돌리는 도구"에서 "상주 감시자"로 승격 |
| 언어 | **전부 TypeScript.** Python 코어·브리지·인터프리터 번들링 개념 자체가 없음 |
| 아키텍처 | sync 엔진 = Electron main 안의 TS 모듈. 엔진/UI 분리는 프로세스 경계가 아니라 **모듈 경계** (엔진은 UI를 모름, contextBridge IPC로만 노출) |
| 구조 | **처음부터 capability + provider.** v1은 Linux provider만 구현하되 모양은 3-OS |
| 전송 계층 | git 저장소(manifest repo) 유지 — 단 **UI 뒤로 숨긴다** |
| DNA 승계 | 아래 §1 목록 — 사용자 승인 완료 |
| 구 repo | 패리티 도달까지 현역. 새 코드로 복사 금지, 행동(테스트 168개)만 캐다 씀 |

## 1. 승계하는 제품 DNA (코드 아님 — 언어 무관 원칙)

1. **안전 불변식 6개** — ① 변조는 dry-run 기본(실행은 명시 확인 게이트) ② 덮어쓰기 전 백업
   (`~/.rigsync-backup/<ts>/`) ③ 시크릿 denylist(id_*, *.pem, *token* 등 — capture가 절대 안 담음)
   ④ capture는 additive-only(ignore에 의한 제거만 예외) ⑤ 삭제는 자동화하지 않고 후보 보고만
   ⑥ 권한 상승 전 실행할 스크립트 전문 노출.
2. **reference/follower 단방향 배포** — 대칭 수렴 아님. reference에서만 capture=저작(commit+push),
   follower는 pull+apply 수신 전용. role 가드(follower에서 capture 차단).
3. **capture-first** — 머신 상태 → 선언적 manifest 회수가 저작의 기본 동선.
4. **DESIGN.md 3분류** — 배포 대상 / 머신 고유(manifest 제외) / 설치 체크리스트(doctor).
   새 기능의 소속 판단 기준. 애매하면 사용자에게.

## 2. 제품 모양

- **온보딩 위저드** — 첫 실행: 머신 이름·role(reference/follower)·manifest repo 연결. 구 rigsync의
  machine-id/role 파일 개념을 UI 흐름으로.
- **메인 화면 = 계기판** — 3초 안에 "이 머신이 기준과 다른가"가 읽힘. Diff(항목별 drift), Doctor
  (체크리스트), 동기화 항목(ignore 토글, 검색·가상 스크롤), Apply(계획 → 스크립트 전문 확인 → 실시간 진행).
- **트레이 상주** — 스케줄된 drift 체크(예: 6시간마다 fetch+diff), drift 발견 시 OS 알림
  ("main이 reference보다 12일 뒤처짐, 항목 7개"), 클릭 → diff 화면. 창 닫아도 트레이에 남음.
- **git은 보이지 않는다** — commit/push/pull은 엔진이 수행, UI는 "동기화됨/뒤처짐"만 말한다.
  (충돌 등 비정상 상태만 표면화.)

## 3. 아키텍처

```
src/
  engine/          # UI를 모르는 순수 TS — 여기가 코어
    capabilities/  # packages, settings, dotfiles, services, scheduled, tools, repos, appimage
    providers/     # linux/ (apt, snap, flatpak, dconf, systemd-user, cron, …) — 이후 darwin/, win32/
    manifest/      # TOML 읽기/쓰기, common/hosts 오버레이 병합
    plan/          # diff → plan → execute (이벤트 emit, dry-run 기본)
    safety/        # denylist, backup, role guard
  main/            # Electron main — 엔진 호스팅, IPC 노출, 트레이, 스케줄러, pkexec spawn
  renderer/        # React + shadcn/ui — 렌더만
  shared/          # IPC 타입 계약
```

- 엔진은 Electron import 금지 (Node API만) — 나중에 CLI·데몬으로 재사용 가능해야 함.
- `execute`는 이벤트 emitter — 렌더러가 IPC로 구독. (구 rigsync progress_cb 구조의 TS 버전.)
- sudo: 엔진이 스크립트 텍스트 생성 → UI가 전문 노출(불변식 ⑥) → main이 pkexec spawn·스트림 파싱.

### capability ↔ 구 layer 대응

| capability | Linux provider (v1) | 구 layer |
|---|---|---|
| packages | apt(+sources/keyrings), snap, flatpak | apt, snap, flatpak |
| settings | dconf | dconf |
| dotfiles | symlink 스토어(.ssh/config는 copy+600) | dotfiles |
| services | systemd --user | services |
| scheduled | cron | cron(services 내) |
| tools | nvm→node→npm 자동 설치 | tools |
| repos | git clone/pull | repos |
| appimage | 버전고정 다운로드 | appimage |
| checks | doctor 체크리스트 | checks |

manifest 포맷은 TOML 유지 (git-diff 가독성, 구 manifest와의 정신적 호환).

## 4. 스택 (제안 — P0에서 확정)

electron-vite + React + TS + Tailwind + shadcn/ui, 패키징 electron-builder(+ 자동 업데이트),
테스트 Vitest. 디자인 체인: frontend-design 플러그인 + shadcn MCP (설치 완료, 2026-07-25).

## 5. Phase

```
P0  스캐폴드 + 디자인 계약     electron-vite 프로젝트, CLAUDE.md 계약 (이 repo에 이미 있음), CI(테스트)
P1  walking skeleton          dotfiles capability 하나로 capture → diff → apply를 앱에서 끝까지 관통
                              (dry-run·백업·denylist 포함 — 안전선은 스켈레톤부터)
P2  capability 확장           P2a packages(apt/snap/flatpak)+ignore+항목화면 → P2b 권한상승(pkexec)
                              → P2c 3계층 정책 구현(§7) → P2d settings/services/scheduled/tools/repos/doctor
                              각 capability마다 구 tests/에서 행동 케이스 채굴 → Vitest로
P3  상주                      트레이, 스케줄 drift 체크, OS 알림
P4  온보딩 + 패키징           위저드, electron-builder, 자동 업데이트
P5  크로스플랫폼 provider     brew/winget, defaults/registry, launchd/schtasks — 난제: 패키지 이름
                              매핑, 권한상승 UX(불변식 ⑥의 macOS/Windows 번역), 플랫폼별 reference 모델
```

P1이 관통하면 이후 P2~P4는 상당 부분 병렬 가능. P5는 독립 트랙.

## 6. 전환

- 구 `~/repos/rigsync`는 **건드리지 않는다**. 패리티(P2 완료) 전까지 실제 동기화는 구 CLI가 담당.
- 구 tests/ 168케이스 = 행동 명세. capability 구현 시 대응 테스트 파일을 읽고 케이스를 옮긴다
  (코드 복사 금지 — 검증된 apply 경로의 신뢰를 새 코드가 다시 버는 가장 싼 길).
- 두 머신 함정 승계: bare python3 문제는 소멸하지만, **hostname 둘 다 "cglab"** 문제는 그대로 —
  machine-id는 온보딩 위저드가 관리.

## 7. 패키지 관리 3계층 정책 (2026-07-25 채택)

정책 원문: `docs/package-policy.md`. 앱을 호출 방식으로 T1(apt)/T2(Flatpak)/T3(AppImage+Gear Lever)로
분류하고 선언적 매니페스트만 동기화한다. 채택에 따른 구현 변경:

- **snap은 동기화 대상에서 제외** (정책 §7 비목표) — 단 provider의 capture/diff 코드는
  **INV-1 중복 설치 검출 전용**으로 유지 (같은 앱의 apt/flatpak/snap/appimage 중복 → 경고만).
  중복 판별은 v1 보수적 휴리스틱(소문자 이름 포함 매칭) + ignore로 끌 수 있게.
- **flatpak provider 확장**: remotes 동기화 + **권한 오버라이드 파일**(`~/.local/share/flatpak/overrides/`)
  동기화 (파일 단위 — dotfiles 메커니즘 재사용).
- **apt baseline 필터**: `apt-mark showmanual`(실측 158개)에서 배포판 기본분을 걸러내기 위해
  **첫 capture 시 baseline 스냅샷**을 머신 로컬에 저장, 이후 baseline과의 diff만 후보로 (§8-B 답).
- **T3 = Gear Lever 통합** — §8-A 검증 완료 (2026-07-25, 이 머신 실측):
  - 설치: user flatpak 4.6.2 (최소 요구 충족). user flathub remote 별도 필요했음.
  - READ: `--list-installed --json` (**`--json`은 --help에 없는 숨은 플래그**). 스키마 실측:
    `{schema_version:1, installed:[{name, path, desktop_id, current_version, available_version,
    download_size, manager, embedded_source, running}]}`. **함정: `name`이 버전 포함 문자열**
    ("tev (2.13.1)") — 매니페스트 키는 `desktop_id` 사용. **좌표(repo)는 JSON에 없음** —
    `~/.var/app/it.mijorus.gearlever/config/gearlever.conf`(INI, `[app.<hash>.update_manager]` 섹션의
    `repo`/`repo_filename`/`manager`)를 **읽기 전용으로 파싱**해 삼중항을 완성한다.
  - WRITE: 좌표→최신 asset URL 해석(GitHub API 등, fetch 주입 가능하게)→다운로드→
    `--integrate <path> --yes`(비대화식 플래그 존재)→`--set-update-source <path> --manager <모델명>
    KEY=value…` (**CLI 존재 확인** — 정책 §3.3 fallback 4단계 불필요). GithubUpdater 필수 키:
    `repo`, `repo_filename`, `allow_prereleases`. 모델명: StaticFileUpdater/GithubUpdater/
    GitlabUpdater/CodebergUpdater/FTPUpdater/ForgejoUpdater. 설정 파일 직접 쓰기 금지 — write는 CLI로만.
  - 선행 조건(doctor): libfuse2t64(24.04 실측 설치됨), AppImageLauncher 부재 확인(충돌 경고),
    Gear Lever ≥4.6.2.
- **profiles 계층**: 오버레이를 `common → profile → host` 3단으로 (머신은 config에서 profile 지정).
- **발산 정책 vs 단방향 모델 해소**: 계층 재분류 감지(매니페스트 T2 ↔ 머신 T1 등)는 모든 머신에서
  하되, **follower에선 보고만**("reference에서 갱신" 안내), 매니페스트 갱신 제안 UI는 reference에서만.
- **업데이트는 비목표** — 최신성은 topgrade 담당, 이 앱은 "무엇이 있어야 하는가"만.
  `topgrade.toml`은 dotfiles 항목으로 처리 (새 capability 아님).
- 매니페스트는 TOML 유지 (정책 문서의 YAML은 예시).
