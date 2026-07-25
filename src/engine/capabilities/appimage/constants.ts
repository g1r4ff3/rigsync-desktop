export const APPIMAGE_LAYER = 'appimage'

/** manifest merge의 array-of-tables 키 필드 — `[[app]]`의 키는 `name`(desktop_id). */
export const APPIMAGE_KEY_FIELDS = { app: 'name' } as const

/** 정책 §3.3 실측 — Gear Lever 최소 요구 버전 (4.6.2 미만은 %F/%U 임포트 크래시). */
export const MIN_GEARLEVER_VERSION = '4.6.2'
