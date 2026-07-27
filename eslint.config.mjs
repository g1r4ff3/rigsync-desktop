import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn/ui가 `shadcn add`로 생성한 벤더 코드 -- house style을 맞추려고
    // 손으로 고치면 다음 `add`/업데이트 때마다 다시 어긋난다. 이 두 규칙만 끈다.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // @electron-toolkit/eslint-config-ts가 이미 최상위 `*.js`/`*.mjs`에는
    // explicit-function-return-type을 꺼주지만, 그 패턴은 서브디렉터리(예:
    // scripts/*.mjs)까지 안 내려온다 -- 1회성 Node 유틸 스크립트라 TS 프로젝트가
    // 아니므로 같은 취지를 여기서도 명시적으로 켠다.
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // v0.1.19 긴급 버그픽스 배경: v0.1.18 providers 비동기화(MaybePromise<T> =
    // T | Promise<T>)에서 `services/diff.ts`의 `provider.isEnabled(u.name)`
    // await 누락이 릴리스됐다 -- "값을 타입 있는 자리에 대입"하는 사용처만
    // tsc가 잡고, truthiness(`if (!x)`)·조건식은 못 잡는 사각지대였다.
    // type-aware 규칙은 src/engine·src/main에만 켠다(renderer는 이 async
    // 계약과 무관 -- React 이벤트 핸들러의 async 관용구까지 물면 소음만
    // 커진다). tsconfig.node.json이 이 두 트리를 커버한다.
    files: ['src/engine/**/*.ts', 'src/main/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },
  eslintConfigPrettier
)
