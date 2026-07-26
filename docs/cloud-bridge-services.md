# 클라우드 브리지 서비스 동기화 — 분류 결정과 checks 엔트리

> **상태**: 결정 확정 (2026-07-26). 코드 변경은 denylist 보강뿐이고, 나머지는 기존
> capability + checks 레이어로 커버된다.
> **계기**: Zotero 첨부 동기화를 랩 NAS WebDAV에서 Google Drive로 옮기면서, 각 머신에
> `rclone serve webdav`를 systemd --user 서비스로 상주시킨 세팅.

---

## 1. 왜 전용 capability를 만들지 않는가

"머신마다 클라우드 브리지 서비스를 세운다"는 작업을 DESIGN 3분류에 넣으면 조각들이
**서로 다른 칸으로 흩어진다** — 그리고 흩어진 결과가 이미 전부 처리돼 있다.

| 조각 | 분류 | 처리 주체 |
|---|---|---|
| `rclone` 설치 | 배포 대상 | packages(T1 apt) — 기존 |
| `~/.config/systemd/user/*.service` 유닛 | 배포 대상 | services capability — 기존 |
| 클라우드 자격증명 (`rclone.conf`) | 머신 고유 | **동기화 금지** (불변식 ③) |
| 서비스 자격증명 (`*.env`) | 머신 고유 | **동기화 금지** (불변식 ③) |
| 앱(Zotero) 내부 설정 | 머신 고유 | 앱 prefs — 범위 밖 |

자동화 가능한 부분은 이미 자동화돼 있고, 남은 부분은 rigsync가 **의도적으로 안 하기로
한 것**이다. 전용 capability를 만들면 대부분이 기존 capability와 중복되고, 중복이 아닌
부분은 만들면 안 되는 부분이다.

### 유닛이 배포 가능한 이유 (설계상 전제)

자격증명을 유닛 파일에 인라인하지 않고 `EnvironmentFile`로 분리했기 때문이다:

```ini
[Service]
EnvironmentFile=%h/.config/rclone/zotero-webdav.env
ExecStart=/usr/bin/rclone serve webdav gdrive-personal:zotero-webdav --addr 127.0.0.1:8180 ...
```

유닛 본문에는 비밀이 없으므로 그대로 배포 대상이 된다. 인라인했다면 유닛 전체가
동기화 불가가 됐을 것이다. **새로 만드는 브리지 서비스도 이 분리를 지킬 것.**

---

## 2. 결과적 갭 — 자격증명 없는 머신

services capability가 유닛을 배포하면, 자격증명이 없는 머신에서는 서비스가 뜨자마자
실패하고 `Restart=on-failure`로 **조용히 재시작만 반복한다.** 사용자에게 아무 신호가
가지 않는다.

이건 "설치 체크리스트" 칸의 문제이므로 doctor가 담당한다 — 새 코드가 아니라 checks
레이어의 데이터로.

## 3. checks.toml 엔트리 (온보딩 시 추가)

```toml
[[check]]
name = "rclone WebDAV 브리지 자격증명"
type = "file"
target = "~/.config/rclone/rclone.conf"
hint = "이 머신에는 아직 클라우드 자격증명이 없습니다. 자격증명은 동기화 대상이 아니므로(불변식 ③) 기준 머신에서 직접 복사해야 합니다."

[[check]]
name = "zotero-webdav 서비스 자격증명"
type = "file"
target = "~/.config/rclone/zotero-webdav.env"
hint = "서비스 계정 파일이 없으면 유닛은 배포돼도 기동 직후 실패합니다. 기준 머신에서 복사 후 chmod 600."

[[check]]
name = "zotero-webdav 서비스 상태"
type = "cmd"
target = "systemctl --user is-active zotero-webdav.service"
expect = "active"
hint = "유닛은 배포됐지만 기동하지 못한 상태입니다. journalctl --user -u zotero-webdav.service 로 원인을 확인하세요."

[[check]]
name = "zotero-webdav 응답"
type = "cmd"
target = "set -a; . ~/.config/rclone/zotero-webdav.env; set +a; curl -s -u \"$RCLONE_USER:$RCLONE_PASS\" -X PROPFIND -H 'Depth: 1' http://127.0.0.1:8180/zotero/ -o /dev/null -w '%{http_code}'"
expect = "207"
hint = "서비스는 떠 있지만 WebDAV 응답이 207이 아닙니다. 401이면 비밀번호 불일치, 연결 거부면 주소·포트 확인."
```

마지막 엔트리는 **비밀번호를 manifest에 담지 않는다** — 실행 시점에 로컬 env 파일에서
읽는다. checks 레이어는 배포 대상이므로 이 체크리스트 자체는 모든 머신에 전파되고,
비밀은 각 머신에 남는다.

체크는 위에서 아래로 **원인 → 증상** 순서다. 자격증명 없음이 먼저 실패하므로, 아래
두 개가 같이 빨개져도 고칠 곳은 하나로 좁혀진다.

---

## 4. denylist 보강 (구현됨)

이 세팅을 하다 실사례로 확인한 구멍 — 자격증명 파일 두 개가 이름 기반 방어를 통과했다:

| 파일 | 왜 통과했나 | 조치 |
|---|---|---|
| `zotero-webdav.env` | `.env*`는 **선행 점**을 요구한다 | `*.env` 추가 |
| `rclone.conf` | 이름은 평범, 내용이 OAuth refresh token | `rclone.conf` 개별 등재 |

같은 부류로 알려진 `.netrc`·`.git-credentials`도 함께 등재했다
(`.git-credentials`는 선행 점 때문에 기존 `credentials*`에 안 걸렸다).

내용 기반 `secretScan`도 함께 보강했다 — 식별자 패턴이 `PASSWORD|SECRET|API_KEY|TOKEN`
뿐이라 `RCLONE_PASS=`를 못 잡았다. 접미 `_PASS`를 **언더스코어 경계 강제**로 추가해
`BYPASS`·`PASSED` 같은 평범한 식별자는 그대로 통과시킨다.

### 접두 고정 패턴 확대

`credentials*` → `*credentials*`로 넓혔다 (2026-07-26 사용자 승인). 구 repo는 접두
고정이라 `.git-credentials`·`.credentials_test`처럼 **선행 점이 붙은 자격증명 파일을
통과**시켰다 — 구 repo 이식 계약을 유지하지 않기로 한 결정에 따라 `*token*`·`*secret*`과
같은 형태로 통일했다. `denylist.test.ts`의 해당 단언도 함께 뒤집었다.

---

## 5. 새 브리지 서비스를 추가할 때

1. 자격증명은 반드시 유닛 밖 별도 파일로 분리 (`EnvironmentFile`).
2. 자격증명 파일 이름이 denylist에 걸리는지 확인 — 안 걸리면 `denylist.ts`에 등재.
3. `checks.toml`에 §3 형태로 자격증명 존재 + 서비스 상태 + 실제 응답 3종 추가.
4. 유닛 자체는 services capability가 알아서 캡처·배포한다 (추가 작업 없음).
