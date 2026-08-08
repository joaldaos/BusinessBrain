// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Los tests unitarios mockean PrismaService/Config con objetos parciales a propósito
    // (ver READMEs de cada módulo) — las reglas de seguridad de tipos de producción no
    // aportan nada aquí y solo generan ruido contra dobles de prueba deliberadamente sueltos.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    // Tests de extremo a extremo (5.9). `supertest` tipa `Response.body` como `any` por
    // contrato de la propia librería: no es un doble suelto nuestro, es que el cuerpo de una
    // respuesta HTTP no se conoce en tiempo de compilación. Aserciones como
    // `response.body.data.id` son la forma normal de escribir estos tests, y tipar cada
    // respuesta a mano solo trasladaría el `any` un nivel más arriba sin ganar nada.
    files: ['test/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
