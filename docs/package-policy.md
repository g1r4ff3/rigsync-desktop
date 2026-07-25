# 패키지 관리 3계층 정책 — 머신 동기화 앱 핸드오프

> **목적**: 머신 간 애플리케이션 환경을 동기화하는 앱을 개발할 때, "무엇을 어디에서 읽고 어떻게 재현할 것인가"의 기준을 정의한다.
> **전제 환경**: Ubuntu (데스크탑/워크스테이션), 렌더링 연구 워크플로 (GPU·CUDA·EXR 파이프라인 포함).
> **상태**: 정책 확정, 구현 인터페이스 일부 검증 필요 (§8 참조).

---

## 1. 핵심 모델

애플리케이션을 **3계층**으로 분류한다. 분류 기준은 앱의 기능이나 도메인이 아니라 **호출 방식**이다. 이는 앱에 대한 사전 지식 없이 판정 가능해야 하기 때문이다.

| 계층 | 판정 기준 | 포맷 | 추적 주체 |
|---|---|---|---|
| **T1 · System** | 터미널에서 타이핑해서 쓰거나, 다른 것이 의존함 | apt (deb) | apt |
| **T2 · Desktop** | 아이콘 클릭으로 실행하고, 호스트 통합이 불필요 | Flatpak | flatpak |
| **T3 · Portable** | T1/T2에 없거나, 버전 고정·병행이 필요함 | AppImage | Gear Lever |

### 1.1 분류 결정 절차

```
앱이 필요하다
  ├─ 터미널에서 호출하나? 또는 빌드/런타임 의존성인가?
  │    └─ YES → T1 (apt). 벤더 APT 저장소가 있으면 그것을 등록. bare .deb 금지.
  ├─ NO → GUI 앱이다
  │    └─ Flatpak으로 설치 시도 (기본값)
  │         ├─ 정상 동작 → T2 확정
  │         └─ 실패 → T1 또는 T3로 강등 (§1.2)
  └─ 어느 저장소에도 없음 → T3 (AppImage + Gear Lever)
```

### 1.2 T2 실패 판정 (강등 트리거)

Flatpak 샌드박스가 부적합한 경우는 **앱의 속성이 아니라 사용 방식의 속성**이므로 사전 예측이 불가능하다. 대신 **실패가 즉시·명시적으로 드러나는 성질**을 이용해 사후 판정한다. 아래 중 하나라도 해당하면 강등:

- 호스트 바이너리를 실행해야 함 (외부 툴 호출 구조)
- CLI 파이프라인에 편입되어야 함 (`flatpak run org.x.Y`가 어색한 지점)
- GPU 컴퓨트(CUDA) 또는 특수 드라이버에 의존
- portal로 우회 불가능한 파일시스템 접근 패턴

> **정책적 함의**: 강등은 정상 경로다. 실패 비용이 낮으므로(`flatpak uninstall` → `apt install`, 약 30초) 동기화 앱은 계층 재분류를 **예외가 아닌 일반 상태 전이**로 모델링해야 한다.

### 1.3 불변 조건

- **INV-1**: 하나의 앱은 정확히 하나의 계층에만 존재한다. 중복 설치(apt + snap + flatpak)는 동기화 앱이 검출하고 경고해야 한다.
- **INV-2**: bare .deb(직접 다운로드한 단일 파일)은 T1이 아니다. 재현 불가능하므로 T3로 대체하거나 벤더 저장소를 찾는다.
- **INV-3**: 프로젝트 스코프 의존성(Python venv, cargo 프로젝트 등)은 3계층 밖이다. §7 비목표 참조.

---

## 2. 동기화 단위: 바이너리가 아니라 매니페스트

**바이너리·설치본 자체를 동기화하지 않는다.** 각 계층의 "무엇이 설치되어 있는가"를 선언적 매니페스트로 추출하고, 대상 머신에서 해당 계층의 네이티브 설치 경로로 재현한다.

```
[머신 A] --- extract ---> manifest.yaml ---> [git/동기화 채널] ---> apply ---> [머신 B]
```

이유:
- 아키텍처·드라이버·배포판 버전 차이를 각 패키지 매니저가 흡수한다.
- 동기화 페이로드가 수 KB로 유지된다 (AppImage 직접 동기화 시 수 GB).
- 롤백과 diff가 텍스트 수준에서 가능하다.

**예외**: 사용자 설정(§4)은 파일 자체를 동기화한다.

---

## 3. 계층별 인터페이스

동기화 앱이 각 계층에 대해 구현해야 할 read/write 연산.

### 3.1 T1 — apt

**READ (상태 추출)**

```bash
# 명시적으로 설치된 패키지만 (의존성으로 끌려온 것 제외)
apt-mark showmanual

# 서드파티 저장소 정의
ls /etc/apt/sources.list.d/          # *.sources (deb822) 및 *.list
ls /etc/apt/keyrings/                # 서명 키
```

**WRITE (재현)**

```bash
# 1) 저장소 정의 파일과 키를 먼저 배치
# 2) apt update
# 3) apt install -y <패키지 목록>
```

**주의**
- 저장소 정의 없이 패키지 목록만 복원하면 서드파티 패키지가 전부 실패한다. **저장소 → 키 → 패키지 순서가 강제된다.**
- `apt-mark showmanual`은 배포판 기본 설치 패키지도 포함하므로, 기준 이미지의 목록과 diff를 떠서 "사용자가 추가한 것"만 남기는 필터가 필요하다.

### 3.2 T2 — Flatpak

**READ**

```bash
flatpak remotes --columns=name,url
flatpak list --app --columns=application,origin,branch,installation
```

**WRITE**

```bash
flatpak remote-add --if-not-exists <name> <url>
flatpak install -y <remote> <app-id>
```

**권한 오버라이드 — 반드시 함께 동기화할 것**

이것이 T2에서 가장 놓치기 쉬운 상태다. Flatseal이나 `flatpak override`로 조정한 권한은 앱 ID와 별개로 저장되며, 이것 없이 앱만 복원하면 **대상 머신에서 앱이 조용히 다르게 동작한다.**

```
~/.local/share/flatpak/overrides/     # user 설치
/var/lib/flatpak/overrides/           # system 설치
```

파일명이 앱 ID이고 내용은 INI 형식이므로 그대로 파일 동기화하면 된다.

### 3.3 T3 — AppImage / Gear Lever

**가장 중요한 계층.** T1/T2는 원래부터 추적 가능했지만, 임의의 GitHub 릴리스 AppImage에 추적 능력을 부여하는 것은 Gear Lever가 유일하다. 동기화 앱의 실질적 가치가 여기 집중된다.

Gear Lever는 3.0.0부터 CLI를, 4.6.0부터 **machine-readable JSON 출력**을 제공한다. 이것이 통합 지점이다.

```bash
# 권장 alias (~/.bashrc)
alias gearlever='flatpak run it.mijorus.gearlever'

gearlever --help
gearlever --list-installed
gearlever --list-updates
gearlever --integrate <path-to-appimage>
```

**JSON 스키마** (검증 필요, §8-A)

문서는 `schema_version: 1`을 가지며 `installed` 또는 `updates` 배열을 포함한다. 각 엔트리 필드:

| 필드 | 의미 | 동기화 용도 |
|---|---|---|
| `name` | 앱 이름 | 매니페스트 키 |
| `path` | 로컬 AppImage 경로 | 머신별로 다름 → **동기화 제외** |
| desktop ID | 데스크탑 엔트리 식별자 | 중복 검출 |
| current version | 현재 버전 | 버전 고정 시 사용 |
| available version | 사용 가능 버전 | 드리프트 검출 |
| download size | 다운로드 크기 | 사전 용량 확인 |
| **update manager** | 업데이트 소스 종류 | **핵심 — 재현의 근거** |
| source embedded 여부 | 업데이트 정보가 AppImage에 내장되었는지 | 재현 전략 분기 |
| running 여부 | 실행 중인지 | apply 시 스킵 판단 |

메타데이터가 없으면 `null`, 빈 목록은 빈 배열로 표현된다.

**업데이트 소스 종류**: GitHub, GitLab, Gitea, Forgejo, Codeberg, 정적 URL(static link), FTP. 이 값이 T3 재현의 전부다 — 앱마다 `(이름, 소스 종류, 소스 좌표)` 삼중항만 있으면 대상 머신에서 최신 버전을 받아 통합할 수 있다.

**WRITE 전략**

CLI에 "소스를 지정해서 등록"하는 단일 명령이 있는지 미확인(§8-A). 없다면 fallback:
1. 매니페스트의 소스 좌표로 최신 릴리스 asset URL을 직접 해석 (GitHub REST API 등)
2. 다운로드
3. `gearlever --integrate <path>`
4. 업데이트 소스는 GUI에서 1회 지정하거나, Gear Lever 설정 파일에 직접 기입

**주의**
- Gear Lever는 Flatpak으로 배포되므로 데이터는 `~/.var/app/it.mijorus.gearlever/` 하위에 위치할 가능성이 높다. 설정 파일을 직접 조작하려면 실제 경로 확인 필요(§8-A).
- 4.6.2에서 AppImage 메타데이터의 `%F`/`%U` 같은 리터럴 퍼센트 기호로 인한 임포트 크래시가 수정되었다. **최소 요구 버전을 4.6.2 이상으로 잡을 것.**
- AppImageLauncher가 설치되어 있으면 다른 AppImage 관리 도구와 충돌할 수 있다. 동기화 앱은 부트스트랩 시 이를 검출하고 경고해야 한다.
- Ubuntu 24.04+ 에서 일부 구형 AppImage는 `libfuse2t64` 설치를 요구한다. T3 부트스트랩의 선행 조건으로 둘 것.

---

## 4. 동기화 대상 / 비대상

| 항목 | 동기화 | 비고 |
|---|---|---|
| apt 패키지 목록 (manual) | O | 기준 이미지 diff 후 |
| apt 서드파티 저장소 + 키 | O | 패키지보다 **먼저** 적용 |
| Flatpak 리모트 + 앱 ID | O | |
| Flatpak 권한 오버라이드 | O | 놓치기 쉬움 — §3.2 |
| AppImage 이름 + 업데이트 소스 | O | T3 재현의 핵심 |
| AppImage 바이너리 자체 | X | 소스에서 재다운로드 |
| `path` 등 로컬 경로 | X | 머신별로 다름 |
| topgrade 설정 (`~/.config/topgrade.toml`) | O | 업데이트 오케스트레이션 일관성 |
| 프로젝트 스코프 의존성 (venv 등) | X | §7 |
| 드라이버, CUDA 툴킷 | 조건부 | 머신 프로파일 의존 — §5 |

---

## 5. 머신 프로파일과 발산

모든 머신이 동일해야 하는 것은 아니다. 매니페스트를 **공통 + 프로파일 오버레이**로 분리한다.

```yaml
# manifest.yaml
schema_version: 1

common:
  apt:
    repositories: [...]
    packages: [git, ripgrep, fd-find, ...]
  flatpak:
    remotes:
      - name: flathub
        url: https://dl.flathub.org/repo/flathub.flatpakrepo
    apps: [org.gimp.GIMP, ...]
  appimage:
    - name: tev
      source: github
      coordinate: Tom94/tev
      pin: null          # null = 최신 추적, "v1.2.3" = 고정

profiles:
  workstation:           # GPU 있음, 렌더링 파이프라인
    apt:
      packages: [nvidia-cuda-toolkit, ...]
    appimage: [...]
  laptop:                # GPU 없음, 문서 작업 위주
    flatpak:
      apps: [...]
```

**발산 정책**
- 프로파일에 없는 앱이 머신에 존재 → **경고만**, 자동 제거하지 않는다 (파괴적 동작 금지).
- 매니페스트에 있는데 머신에 없음 → 설치 후보로 제시.
- 계층이 다름 (매니페스트는 T2, 머신은 T1) → §1.2 강등이 발생한 것일 수 있으므로 **머신 쪽을 신뢰**하고 매니페스트 갱신을 제안한다.

---

## 6. Apply의 요구 성질

- **멱등성**: 같은 매니페스트를 두 번 적용해도 결과가 같아야 한다.
- **Dry-run 필수**: `topgrade -n`과 동일한 사고방식. 적용 전에 diff를 전부 보여준다.
- **순서 보장**: 저장소/리모트 → 키 → 패키지 → 권한 오버라이드. AppImage는 `libfuse2t64` 등 선행 조건 확인 후.
- **부분 실패 허용**: 한 앱의 설치 실패가 전체를 중단시키지 않는다. 실패 목록을 수집해서 마지막에 보고.
- **비파괴**: 제거는 절대 자동으로 하지 않는다. 제안만 한다.

### 업데이트는 동기화 앱의 책임이 아니다

동기화 앱은 **"어떤 앱이 있어야 하는가"**만 관리한다. **"최신인가"**는 `topgrade`가 담당한다. 이 경계를 지켜야 앱이 비대해지지 않는다.

```bash
topgrade -n    # dry-run
topgrade       # apt / flatpak / snap / cargo / pipx / npm / rustup 일괄
```

Gear Lever는 topgrade가 자동 감지하지 못할 수 있으므로 커스텀 명령으로 편입:

```toml
# ~/.config/topgrade.toml
[commands]
"AppImages" = "flatpak run it.mijorus.gearlever --list-updates"
```

---

## 7. 비목표 (Non-goals)

명시적으로 범위 밖:

- **프로젝트 스코프 의존성**: Python venv, `uv`/`pip` 프로젝트 의존성, cargo 프로젝트 의존성. 이들은 프로젝트 저장소의 lockfile이 담당한다. 전역 오염을 피하기 위해 동기화 앱이 건드리지 않는다.
- **dotfiles 일반**: 셸 설정, 에디터 설정 등. 별도 도구(chezmoi, GNU stow, 또는 기존 git 저장소)의 영역.
- **Snap**: Ubuntu 기본 탑재분(firefox 등) 외에는 사용하지 않는 것이 정책. 능동적으로 관리하지 않는다.
- **완전 선언적 재현**: 진정한 재현성이 필요하면 Nix/Home Manager가 정답이며, 이 앱은 그것의 대체재가 아니다. 이 앱은 **"기존 생태계 위의 얇은 조정 레이어"**를 지향한다.
- **자동 제거**: §6 비파괴 원칙.

---

## 8. 검증 필요 항목

구현 전 실제 머신에서 확인할 것.

**A. Gear Lever CLI 계약** (최우선 — T3 전체가 여기 의존)
```bash
flatpak run it.mijorus.gearlever --help
flatpak run it.mijorus.gearlever --list-installed        # JSON 출력 형태 확인
```
확인 항목:
- JSON 필드명의 정확한 표기 (본 문서의 필드 목록은 설명 기반이며 실제 키 이름 미확인)
- 업데이트 소스를 **CLI로 지정**하는 명령의 존재 여부 → 없으면 §3.3 fallback 채택
- 설정/상태 파일의 실제 경로 (`~/.var/app/it.mijorus.gearlever/` 하위 추정)
- 설치된 버전이 4.6.2 이상인지

**B. apt 기준선**
- `apt-mark showmanual` 출력에서 배포판 기본 설치분을 걸러낼 방법 확정 (기준 이미지 스냅샷 vs 화이트리스트)

**C. Flatpak 오버라이드**
- user/system 설치 혼재 시 오버라이드 경로 우선순위 확인

**D. 선행 조건**
- 대상 Ubuntu 버전에서 `libfuse2t64` 필요 여부
- AppImageLauncher 설치 여부 검출 방법

---

## 9. 요약 (한 문단)

앱을 호출 방식으로 T1(apt) / T2(Flatpak) / T3(AppImage+Gear Lever)로 분류하고, 각 계층에서 **바이너리가 아닌 선언적 매니페스트**를 추출·재현한다. T1/T2는 기존 패키지 매니저가 이미 추적하므로 동기화 앱은 목록과 저장소 정의(및 Flatpak 권한 오버라이드)만 다루면 되고, **실질적 신규 가치는 T3에 있다** — Gear Lever의 JSON CLI를 통해 `(이름, 업데이트 소스 종류, 소스 좌표)` 삼중항을 관리하는 것이 핵심이다. 최신성 유지는 topgrade에 위임하고, 동기화 앱은 "무엇이 있어야 하는가"에만 집중한다. 모든 apply는 멱등적·비파괴적이며 dry-run이 선행된다.
