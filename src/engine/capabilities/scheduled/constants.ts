/**
 * scheduled(cron) 레이어는 manifest 테이블이 없다 — 구 repo(`capture_cron`,
 * rigsync.py:1613)도 crontab 전체를 파일 하나로만 저장하고 `cfg.write_common`을
 * 호출하지 않는다(파일 단위 캡처, 라인 단위 아님 — 정책이 명시한 계승 함정).
 */
export const SCHEDULED_STORE_REL_PATH = 'scheduled/crontab.txt'
