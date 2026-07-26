# 리팩토링 스펙 v0.2 — 무상태 분류 + 설계 결함 감사

> 2026-07-27 작성. baseline 사고(아래 §1)를 계기로 한 재설계 + 같은 부류 결함의 전수 감사 결과.
> **새 세션 인수용 문서** — 이 문서만 읽고 이어서 작업할 수 있어야 한다. 사용자 컨펌 후 착수.
> 현재 상태: v0.1.5 릴리스됨, main `2206117`+α, 테스트 570, 원격 `g1r4ff3/rigsync-desktop`(public)·
> manifest `g1r4ff3/rigsync-manifest`(private). 두 머신: 연구실 `cglab`(reference) · 집 `seongil-home`(follower).

---

## 0. 이 스펙의 판단 원칙 (사고에서 승격된 교훈)

1. **속성은 계산하고, 이력은 기록하지 않는다.** "배포판 기본분인가"는 패키지의 속성인데
   "첫 capture 때 깔려 있었나"라는 이력으로 대신 기록한 것이 baseline 사고의 뿌리다.
   같은 형태(시점 스냅샷·상태 파일)가 보이면 의심하라.
2. **보이지 않는 필터링 금지.** 무엇을 숨기든 접힌 그룹으로 보여주고 펼칠 수 있어야 한다.
   baseline은 zotero를 *소리 없이* 삼켰다는 게 진짜 죄였다.
3. **화면은 머신이 아는 것만 말한다.** follower는 reference 상태를 모른다 —
   "이 머신에만 있음" 같은 단정은 거짓이 될 수 있다.

---

## 1. 본체: apt 무상태(stateless) 분류 — 사용자 방향 승인됨, 상세 컨펌 대기

### 1.1 사고 요약
- baseline(`apt-baseline.txt`) = 첫 capture 시점의 `apt-mark showmanual` 전체 스냅샷.
- reference에서 그 시점에 이미 깔려 있던 사용자 앱(zotero·zsh·wezterm)이 배포판 기본분과 함께
  삼켜져 manifest에 못 들어감 (158/159가 baseline → 차집합 ≈ 1).
- follower엔 baseline 파일 자체가 없어 필터 미작동 → 배포판 기본분까지 159개 전부 후보로 표출.
- follower 라벨 "이 머신에만 있음"도 이 경우 거짓 (양쪽 다 설치돼 있었음).

### 1.2 확정 설계
**분류 규칙 (매 조회 시 계산, 상태 파일 없음, 어느 머신에서나 동일):**
1. 설치본의 저장소 출처가 Ubuntu가 아니면(서드파티 repo) → **사용자 설치** (확정 신호).
2. 설치된 배포판 메타패키지(`(ubuntu|kubuntu|xubuntu|lubuntu)-(minimal|standard|desktop|desktop-minimal)`)의
   의존+추천 폐포(`apt-cache depends --recurse --installed --no-suggests …`)에 있으면 → **배포판 기본**.
3. priority ∈ {required, important, standard} → **배포판 기본**. 그 외 → **사용자 설치**.

**실측 검증 (연구실 머신, 2026-07-27):** manual 159 → 배포판 28 / 사용자 131.
zotero·zsh·wezterm·code·claude-desktop·cmake·zsync 전부 "사용자"로 정확 판정.
ubuntu-wallpapers·wpasupplicant는 폐포로 "배포판" 판정. 검증 스크립트는 세션 스크래치패드
`classify-apt.py` (재현 가능 — 규칙만 있으면 재작성 쉬움).

**구현 조각:**
- `apt-baseline.txt` 개념·파일·관련 코드 은퇴 (ctx.aptBaselinePath 등).
- 분류기는 provider 뒤 격리(`apt-cache policy` 배치 파싱 + depends 폐포 + dpkg priority),
  조회당 캐시. 실측 케이스를 픽스처로 고정.
- **capture**: "사용자 설치" 판정분만 자동 추가 대상 (기존 additive-only·ignore 규약 그대로).
- **예외 저장(예외만 기록)**: 사용자 판정인데 안 보냄 = 기존 ignore.toml.
  배포판 판정인데 보냄 = 신설 include (ignore.toml에 include 섹션 또는 별도 파일 — 구현 시 결정,
  값 아닌 패키지명만).
- **UI**: Candidates apt 그룹을 "사용자 설치 (N)" + **"배포판 기본 (M)" 접힌 그룹**(펼치기 가능,
  4상태 컨트롤 동일 적용)으로. 절대 숨기지 않는다.
- **follower 라벨 정정**: "이 머신에만 있음" → "manifest에 없음 (동기화 안 됨)" 취지로
  (`copy.ts`의 role 분기 함수들 수정).

**마이그레이션**: baseline 파일 삭제 → reference에서 사용자 판정 ~131개가 후보로 드러남 →
사용자가 일괄 토글로 1회 큐레이션 → Capture. (분류기는 배포판 소음 제거까지만 책임지고,
131개 중 무엇을 보낼지는 사용자 몫 — lib*-dev·language-pack류 포함.)

---

## 2. 감사 발견 (증거 확인됨, 심각도순)

### F1 🔴 머신 고유 절대경로가 든 cron·systemd 유닛이 follower에 배포됨 — **집 머신 실파손 추정**
증거 (manifest 실측):
- `scheduled/crontab.txt`: `/home/cglab` 경로 1건 (PATH + sync-claude-to-opencode.sh 라인).
- `services/systemd-user/cliproxyapi.service`: `WorkingDirectory=/home/cglab/cliproxyapi`,
  `ExecStart=/home/cglab/cliproxyapi/cli-proxy-api`, `Environment=HOME=/home/cglab`.
- 집 머신은 사용자가 `seongil` → 전체 apply를 이미 실행했으므로 **집 머신에서 지금
  15분마다 실패하는 cron + 시작 실패하는(또는 무의미한 랩 전용) 서비스가 돌고 있을 가능성이 높다.**
이중 결함: (a) 이식성 검사 부재 — `.zshrc`는 이미 한 번 같은 사고를 냈고 그때 "Doctor 이식성
경고"가 제안됐으나 **미구현** (b) "머신 고유" 항목을 계층으로 보낼 방법이 없음 → F2.
**응급 조치 (스펙 착수와 별개로 우선)**: 집 머신에서 해당 crontab 라인 제거·cliproxyapi 서비스
disable, manifest에서 두 항목을 ignore 또는 host 계층 이동(F2 후).

### F2 🟠 capture가 계층 라우팅을 못 한다 — "머신 고유" 칸이 구현에 없음
증거: 모든 capability capture가 `writeCommonLayer`만 호출 (grep 확인). merge는
common→profile→host 3단을 지원하지만 **쓰기는 common뿐**. DESIGN 3분류(배포 대상/머신 고유/
체크리스트)의 가운데 칸이 앱에 없어서 cliproxyapi 같은 랩 전용 항목이 전 머신에 배포된다.
**제안**: 항목을 host 계층으로 보내는 경로 신설 — 최소형은 Candidates/항목 컨트롤에
"이 머신 전용(host)" 표시·전환 + capture 시 host 계층 유지. UI 형태는 구현 시 결정.

### F3 🟠 follower 심링크 모델 — 로컬 편집이 pull을 깨뜨린다
구조: follower의 `~/.zshrc` 등은 apply 후 manifest 작업 트리로의 **심링크**. follower에서
파일을 편집하면(자연스러운 행위) manifest가 dirty → 다음 `git pull --ff-only` 실패 → 동기화
정지 (ignore 토글 건으로 이미 실증된 병인의 확장판 — 그때는 토글만 막았고 편집 경로는 열려 있다).
**결정 필요 (D2)**: (a) Doctor에 "manifest dirty" 검사 + 해소 안내(최소) /
(b) follower는 심링크 대신 복사 모드로 apply(전파는 pull+재apply로) /
(c) pull 전 자동 stash(충돌 위험 — 비추천).

### F4 🟡 reference 일상 편집의 전파가 비결정적이다
구조: 심링크라 store 파일은 즉시 바뀌지만, commit+push는 **다음 아무 capture/토글**이
`addAllAndCommit`(전체 스테이징 — sync.ts:45 확인)을 돌릴 때 우연히 실린다. 커밋 메시지
("capture: …")와 실제 내용이 어긋나고, follower 전파 지연이 예측 불가. 라이브 편집으로 들어온
비밀은 push 게이트가 커버함(확인됨).
**결정 필요 (D3)**: (a) drift 스케줄러가 dirty 감지 시 "dotfiles 라이브 편집" 별도 커밋 자동
생성+push / (b) Doctor 표시 + 수동 "지금 동기화" / (c) 현행 유지+문서화.

### F5 🟡 레지스트리 미등록 폰트는 여전히 파일명 정확 일치 (binaries도 동일 구조)
`fonts/diff.ts` 주석으로 명시된 한계 — 미등록 항목이 버전 박힌 파일명이면 "영원히 불일치"
함정이 재발 가능. **제안**: capture 시 미등록+버전성 파일명(`-\d+\.\d+` 패턴)이면 경고 표시
("소스 미지정 + 버전성 파일명 — 다른 머신에서 수렴하지 않을 수 있음").

### F6 ⚪ apt keyring 파일 스냅샷의 부패 가능성
키 회전 시 manifest 사본이 낡는다. 낮은 우선순위 — Doctor 후보 항목으로만 기록.

### 통과 확인 (결함 아님)
- fonts `pin`: capture가 절대 갱신하지 않음 (capture.ts 주석·코드 확인 — 의도된 불변).
- apt apply: sources 변경 시 `apt-get update` 액션 존재 (정책 §6 순서 보장 준수).
- 라이브 편집 유입 비밀: push 게이트가 manifest 전체 재검사로 커버.
- snap 검출 전용·비밀 스캐너 자기신고·Candidates 라벨은 v0.1.5까지 처리 완료.

---

## 3. 구현 순서 제안

| 단계 | 내용 | 근거 |
|---|---|---|
| P0 | **응급**: 집 머신 cron·cliproxyapi 정리 + manifest에서 두 항목 처리 | F1 실파손 중단 |
| P1 | §1 본체 — 분류기+baseline 은퇴+include 예외+접힌 그룹+follower 라벨 | 승인된 본체 |
| P2 | 이식성 Doctor 검사(dotfiles·cron·services에서 `/home/<다른 사용자>` 참조 탐지) + F2 host 라우팅 | F1 재발 방지 |
| P3 | F3 follower dirty 대응 (D2 결정 반영) | 동기화 정지 방지 |
| P4 | F4 전파 의미론 (D3 결정 반영) | 품질 |
| P5 | F5 경고 + F6 Doctor 후보 | 잔존 정리 |

P1 완료 시 v0.1.6 릴리스, P2~P4는 결정·규모에 따라 v0.1.7+.

## 4. 사용자 결정 대기 목록

- **D1 (F1 처리)**: crontab·cliproxyapi를 manifest에서 ignore로 뺄지, F2 구현 후 host 계층으로
  옮길지. (응급 조치 자체는 어느 쪽이든 즉시.)
- **D2 (F3)**: follower 로컬 편집 정책 — Doctor 경고만(최소) vs 복사 모드 전환.
- **D3 (F4)**: reference 라이브 편집 전파 — 자동 커밋 vs Doctor+수동.
- §1 상세(include 저장 위치, 접힌 그룹 UI)는 구현 재량으로 위임 가능.

## 5. 작업 규율 (이 repo 관례 — 새 세션도 준수)

- 착수 전 `CLAUDE.md`(안전 불변식 — 5는 2026-07-26 개정됨·Explanability contract·Design
  constraints) Read. 테스트 기준선 570 유지·증가, typecheck/lint/build 통과, 엔진 순수성
  grep(`from 'electron'|from 'react'` in src/engine/) 무매치.
- **수렴 테스트 관례**: 상태를 바꾸는 기능은 "실행 → 재-diff = drift 0"을 테스트로 고정.
- UI 변경은 스크린샷 하네스(`RIGSYNC_SCREENSHOT_DIR=<dir> RIGSYNC_SCREENSHOT_THEME=light|dark
  npm run dev`)로 캡처해 이미지를 직접 열어 검수 (reference/follower × light/dark).
- 실기 검증은 read-only만, 쓰기 검증은 픽스처 $HOME. 실제 사용자 config·manifest·홈 수정 금지
  (manifest 저작은 코디네이터/사용자 승인 하에만).
- `git add`는 명시 경로만(`-A` 금지 — 실사고 2회), push는 코디네이터가 검토 후. 릴리스는
  `npm run build:linux`(zsync 필요 — 설치됨) 후 `gh release create vX.Y.Z` + AppImage/.zsync/deb
  3종 업로드. 커밋 말미 `Co-Authored-By: Claude <해당 모델> <noreply@anthropic.com>`.
