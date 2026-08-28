import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeCode,
} from './recovery-codes';

describe('códigos de recuperación', () => {
  const SECRETO = 'un-secreto-de-aplicacion';

  it('se entregan diez', () => {
    expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('CRÍTICO: no se repiten entre sí ni entre tandas', () => {
    const todos = new Set([
      ...generateRecoveryCodes(),
      ...generateRecoveryCodes(),
      ...generateRecoveryCodes(),
    ]);

    expect(todos.size).toBe(RECOVERY_CODE_COUNT * 3);
  });

  it('no llevan caracteres que se confunden al copiar de un papel', () => {
    // Ni `l`, ni `1`, ni `0`, ni `o`. Quien teclea desde un papel se equivoca justo en esos.
    for (const codigo of generateRecoveryCodes(30)) {
      expect(codigo).toMatch(
        /^[abcdefghjkmnpqrstuvwxyz23456789]{5}-[abcdefghjkmnpqrstuvwxyz23456789]{5}$/,
      );
    }
  });

  describe('cómo se guardan', () => {
    it('CRÍTICO: lo que se guarda no se parece al código', () => {
      const [codigo] = generateRecoveryCodes(1);
      const guardado = hashRecoveryCode(codigo, SECRETO);

      expect(guardado).not.toContain(codigo);
      expect(guardado).toMatch(/^[0-9a-f]{64}$/);
    });

    it('CRÍTICO: sin el secreto de la aplicación, el hash no se puede recalcular', () => {
      // Es la diferencia entre HMAC y un sha256 pelado: quien leyera la tabla no podría
      // componer ningún código sin conocer además el secreto.
      const [codigo] = generateRecoveryCodes(1);

      expect(hashRecoveryCode(codigo, SECRETO)).not.toBe(
        hashRecoveryCode(codigo, 'otro-secreto'),
      );
    });

    it('el mismo código da siempre el mismo hash', () => {
      const [codigo] = generateRecoveryCodes(1);

      expect(hashRecoveryCode(codigo, SECRETO)).toBe(
        hashRecoveryCode(codigo, SECRETO),
      );
    });

    it('tolera cómo lo escribe una persona', () => {
      // Mayúsculas y espacios: quien copia de un papel escribe las dos cosas, y rechazarle un
      // código correcto por eso sería incomprensible justo cuando ya no tiene el móvil.
      const [codigo] = generateRecoveryCodes(1);
      const esperado = hashRecoveryCode(codigo, SECRETO);

      expect(hashRecoveryCode(codigo.toUpperCase(), SECRETO)).toBe(esperado);
      expect(hashRecoveryCode(`  ${codigo}  `, SECRETO)).toBe(esperado);
      expect(hashRecoveryCode(codigo.replace('-', ' - '), SECRETO)).toBe(
        esperado,
      );
    });

    it('códigos distintos dan hashes distintos', () => {
      const [uno, dos] = generateRecoveryCodes(2);

      expect(hashRecoveryCode(uno, SECRETO)).not.toBe(
        hashRecoveryCode(dos, SECRETO),
      );
    });
  });

  it('normaliza a minúsculas y sin espacios', () => {
    expect(normalizeCode('  AB CD-EF GH  ')).toBe('abcd-efgh');
  });
});
