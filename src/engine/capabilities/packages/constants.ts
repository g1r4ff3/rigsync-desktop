export const PACKAGES_LAYER = 'packages'

/**
 * manifest merge의 array-of-tables 키 필드 (구 repo `LAYER_KEY_FIELDS`의
 * apt/snap/flatpak 항목 이식). 배열 이름이 provider 간에 겹치지 않으므로
 * (sources/snap/remote/app) 하나의 flat map으로 충분하다 — `mergeLayer`가
 * 중첩 테이블을 재귀할 때도 같은 map을 그대로 넘긴다.
 */
export const PACKAGES_KEY_FIELDS = {
  sources: 'name',
  snap: 'name',
  remote: 'name',
  app: 'application'
} as const
