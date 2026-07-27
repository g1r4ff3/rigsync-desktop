/**
 * providers 비동기화(perf 3라운드) 공용 타입 — 워커 스레드 안에서
 * `spawnSync`(및 잔존 동기 exec 계열)가 스레드 전체를 멈추는 문제를 없애기
 * 위해 provider 인터페이스 반환형을 이걸로 바꾼다. 실제 구현(`providers/linux/*`)은
 * `Promise<T>`(promisify된 execFile)를 돌려주고, 테스트 fake는 기존처럼 `T`를
 * 동기로 돌려줘도 그대로 유효하다(`T`는 `MaybePromise<T>`의 부분집합) — 테스트
 * 718개를 거의 그대로 살리는 핵심 트릭. 호출부는 항상 `await`한다(비-promise
 * 값에 대한 await는 no-op이라 안전 — MDN `await` 명세: thenable이 아니면 다음
 * microtask에서 그대로 resolve).
 */
export type MaybePromise<T> = T | Promise<T>
