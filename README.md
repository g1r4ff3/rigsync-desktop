# rigsync-desktop

머신 여러 대를 쓰는 한 사람을 위한, **설정 동기화 데스크탑 앱**. "이 컴퓨터에 뭐가
설치돼 있고 뭐가 다른 컴퓨터랑 다른지"를 3초 안에 보여주고, 다른 컴퓨터를 기준에
맞추는 작업(설치·설정 반영)을 안전하게 대신해준다.

터미널을 몰라도 되는 게 목표다 — Claude Desktop처럼 앱 하나로 끝난다. Electron +
React + TypeScript로 만들어졌고, 현재는 **Linux 전용**(개인 도구, 실제 사용 환경만
지원)이다.

![Differences 대시보드](docs/img/dashboard-differences.png)

## 왜 만들었나

컴퓨터를 여러 대(연구실 머신·집 컴퓨터 등) 쓰다 보면 "이 셸 설정 저 머신에도
있었나", "그 패키지 여기도 깔았던가" 같은 걸 매번 기억에 의존하게 된다. rigsync는
그 기준을 **git 저장소(manifest)에 선언적으로 박아두고**, 각 머신은 그 기준과
비교해서 "뭐가 아직 안 맞나(diff)"를 보여주고 "맞춰라(apply)"를 실행한다.

## reference / follower — 단방향 배포 모델

머신은 양방향으로 동기화되지 않는다. 정확히 한 대만 **reference**(기준 머신 —
직접 만지고 저장소에 커밋·푸시하는 쪽)이고, 나머지는 전부 **follower**(수신 전용 —
기준을 pull해서 반영만 하는 쪽)다. follower에서는 애초에 "저장"(capture) 자체가
막혀 있다 — 실수로 follower가 기준이 되어버리는 사고를 구조적으로 차단한다.

## 무엇을 동기화하는가 — 9개 capability

| capability | 무엇을 다루나 |
|---|---|
| **packages** | apt(+커스텀 소스/keyring) 패키지 목록 — INV-1: flatpak/snap/AppImage 중복 설치도 감지 |
| **dotfiles** | 심링크/복사로 관리하는 개인 설정 파일 (`.zshrc`, `.gitconfig` 등) |
| **settings** | dconf(GNOME 등 데스크톱 환경 설정) |
| **services** | systemd `--user` 유닛 |
| **scheduled** | 사용자 crontab |
| **tools** | nvm으로 관리하는 Node 버전 + 전역 npm 패키지 |
| **repos** | git clone으로 관리하는 로컬 저장소 |
| **appimage** | [Gear Lever](https://github.com/mijorus/gearlever)로 통합 관리하는 AppImage (T3 — 아래 "3계층 패키지 정책" 참조) |
| **fonts** | 설치된 폰트 패밀리 |

이 위에 **Doctor**(설치 전제조건 체크리스트 — Gear Lever 버전, NVIDIA 드라이버
정합성, manifest 소급 시크릿 스캔, rigsync 자신의 자동 업데이트 소스 설정 여부 등)가
조회 전용으로 얹힌다.

## 3계층 패키지 정책

"이 패키지를 어떻게 설치할까"는 앱을 손대지 않고 결정할 수 있는 문제가 아니라서,
호출 방식별로 3계층으로 분류해 관리한다 (`docs/package-policy.md`에 전문):

- **T1 (apt)** — 배포판 저장소로 설치되는 표준 패키지.
- **T2 (Flatpak)** — 샌드박스 GUI 앱. remote·권한 오버라이드까지 동기화.
- **T3 (AppImage + Gear Lever)** — 단일 바이너리 배포 앱(이 앱 자신도 T3다).
  Gear Lever가 통합·업데이트 추적을 맡고, rigsync는 좌표(어디서 받은 AppImage인지)
  만 선언적으로 동기화한다.

최신성 자체는 이 앱의 목표가 아니다 — 그건 [topgrade](https://github.com/topgrade-rs/topgrade)
같은 도구가 하고, rigsync는 "무엇이 설치돼 있어야 하는가"만 다룬다.

## 안전 불변식 — 왜 이렇게 설계했나

머신을 실제로 바꾸는 도구이므로, "일단 해보고 잘못되면 되돌리자"가 아니라
애초에 잘못될 수 있는 경로를 구조적으로 좁히는 쪽을 택했다.

- **dry-run이 기본값이다.** diff·plan은 언제나 조회만 하고, 실제로 시스템을
  바꾸는 것(Apply)은 별도의 명시적 확인을 거쳐야 실행된다.
- **덮어쓰기 전엔 항상 백업한다** (`~/.rigsync-backup/<timestamp>/`). 되돌릴 수
  없는 변경은 만들지 않는다.
- **시크릿 denylist.** capture(머신 상태 → manifest 회수)는 `id_*`, `*.pem`,
  `*token*`, `*secret*`, `.env*`, `credentials*` 같은 이름 패턴을 가진 파일을
  애초에 담지 않는다. Doctor의 secret scan은 한 걸음 더 나가 이 관문을 우회해
  manifest에 이미 들어간 시크릿까지 소급으로 찾아 경고한다.
- **capture는 additive-only.** 항목이 사라지는 건 사용자가 ignore 설정으로
  명시했을 때뿐 — 자동으로 뭔가를 빼지 않는다.
- **삭제는 자동화하지 않는다.** 후보를 보여줄 뿐, 실행은 항상 사람이 한다.
- **권한 상승 전엔 스크립트 전문을 보여준다.** `pkexec`로 실행될 명령을 실행
  직전에 있는 그대로 노출한다 — 뭘 승인하는지 모르고 승인하는 상황을 막는다.

## 설치

### Gear Lever로 (권장 — 자동 업데이트 추적)

1. [Gear Lever](https://github.com/mijorus/gearlever)를 설치한다 (Flathub:
   `it.mijorus.gearlever`).
2. [Releases](../../releases)에서 최신 `rigsync-desktop-*.AppImage`를 내려받는다.
3. Gear Lever로 열어 통합(integrate)한다.

빌드 산출물 자체에 업데이트 소스가 심겨 있어(`.upd_info` ELF 섹션 —
`gh-releases-zsync|g1r4ff3|rigsync-desktop|latest|<파일명>.zsync`), **통합하는
순간 Gear Lever가 자동으로 인식**하고 이후 업데이트를 추적한다 — 별도 설정
불필요.

이 자동 인식 전(구버전에서 넘어왔거나, 위 embed 이전에 통합해 뒀거나)이라
`[UpdatesNotAvailable]`로 남아 있다면: rigsync는 실행할 때마다 자기 자신이
Gear Lever에 통합돼 있고 소스가 없는 상태인지 확인해 **한 번 스스로
등록을 시도한다**(실패해도 반복하지 않는다 — Doctor 탭 "Auto-update (self)"에서
결과를 확인할 수 있다). 그래도 안 됐다면 아래를 그대로 실행한다(AppImage
경로는 실제 설치 위치로 바꾼다):

```bash
flatpak run it.mijorus.gearlever --set-update-source "<AppImage 경로>" \
  --manager GithubUpdater repo=g1r4ff3/rigsync-desktop \
  repo_filename='rigsync-desktop-*.AppImage' allow_prereleases=false
```

### deb 패키지로

[Releases](../../releases)에서 `rigsync-desktop_*_amd64.deb`을 내려받아
`sudo apt install ./rigsync-desktop_*_amd64.deb` (또는 GUI 패키지 관리자로 설치).

## 빌드에서 개발까지

```bash
npm install
npm run dev          # 개발 모드 실행
npm test              # Vitest
npm run typecheck
npm run lint
npm run build:linux   # AppImage + deb 산출 (dist/)
```

## 개발 상태

개인 도구다 — 저 사람이 쓰는 두 대(연구실 reference, 집 follower)를 기준으로
개발되고 검증된다. Linux 전용, 크로스플랫폼(macOS/Windows)은 아직 계획만 있다
(`FORWARD.md` P5). 버그·아이디어는 이슈로 남겨도 되지만 응답 속도는 보장 못한다.

## 참고 문서

- `FORWARD.md` — 설계 계획·phase
- `CLAUDE.md` — 개발 규율·디자인 계약
- `docs/package-policy.md` — 3계층 패키지 정책 전문
