/**
 * services capability가 systemd --user 유닛을 조회/적용하는 유일한 통로.
 * `systemctl --user`는 sudo 없이 실행되므로(구 repo도 sudo를 쓰지 않는다) 이
 * capability의 plan 액션은 전부 unprivileged라 테스트에서도 `run()`이 실제로
 * 호출된다 — 그래서 라이브 유닛 파일 읽기/쓰기·enable·daemon-reload를 전부 이
 * 인터페이스 뒤로 격리한다(P2c flatpak override 복원과 동일한 이유).
 *
 * perf 3라운드(providers 비동기화): 실제 systemctl 호출 메서드는
 * `MaybePromise<T>`(`src/engine/async.ts`)를 돌려준다.
 */
import type { MaybePromise } from '../../async'

export interface ServiceUnitFile {
  readonly name: string
  readonly content: string
}

export interface ServiceCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface SystemdUserProvider {
  /** `~/.config/systemd/user/*.service` 각 유닛 파일의 이름+내용. */
  listUnitFiles(): ServiceUnitFile[]
  /** 유닛 파일 하나를 이름으로 읽는다 (없으면 null). */
  readUnitFile(name: string): string | null
  /** `systemctl --user is-enabled <name>`. */
  isEnabled(name: string): MaybePromise<boolean>
  /** 라이브 유닛 파일을 덮어쓴다(호출 전 백업은 호출자 책임). */
  writeUnitFile(name: string, content: string): ServiceCommandResult
  /** `systemctl --user daemon-reload`. */
  daemonReload(): MaybePromise<ServiceCommandResult>
  /** `systemctl --user enable <name>`. */
  enable(name: string): MaybePromise<ServiceCommandResult>
}
