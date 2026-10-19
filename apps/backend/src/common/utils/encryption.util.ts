import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';
import type { AppConfig } from '../../config/configuration';
import { scopeLabel, type EncryptionScope } from './encryption-scope';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recomendado para GCM

/**
 * Marca de versión del formato. Sin ella no se podría cambiar la derivación sin dejar
 * ilegible todo lo ya cifrado.
 */
const V2 = 'v2';

/**
 * Cifra secretos en reposo (KnowledgeSource.configEnc, LlmProfile.apiKeyEnc,
 * Integration.accessTokenEnc/refreshTokenEnc, User.mfaSecretEnc).
 *
 * ## Dos formatos, y por qué conviven
 *
 * - **Heredado**: `iv:authTag:ciphertext`, cifrado con la clave maestra. **Una sola clave
 *   descifraba los secretos de todos los clientes.**
 * - **v2**: `v2:iv:authTag:ciphertext`, cifrado con una clave DERIVADA del ámbito (la
 *   organización, o el usuario). Confundir ámbitos deja de ser un descuido posible: un
 *   secreto de una empresa no se puede descifrar en el contexto de otra porque la clave ni
 *   siquiera existe ahí.
 *
 * Lo ya cifrado sigue leyéndose el primer día y migra solo: cada vez que un secreto se
 * reescribe, sale en v2. No hace falta ninguna migración de datos, y nadie se queda fuera.
 *
 * La clave maestra (ENCRYPTION_KEY) se valida en env.validation.ts como base64 de 32 bytes.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  /** Las derivadas se memorizan: HKDF por cada hecho de un lote sería trabajo tirado. */
  private readonly derived = new Map<string, Buffer>();

  constructor(configService: ConfigService<AppConfig, true>) {
    const encryptionKeyBase64 = configService.get('encryptionKey', {
      infer: true,
    });
    const key = Buffer.from(encryptionKeyBase64, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY debe decodificar a exactamente 32 bytes (AES-256)',
      );
    }
    this.key = key;
  }

  /**
   * Cifra un secreto PARA un ámbito concreto. Es la vía que debe usarse de aquí en adelante.
   */
  encryptFor(scope: EncryptionScope, plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.keyFor(scope), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      V2,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * Descifra un secreto de un ámbito.
   *
   * Un payload heredado —sin marca de versión— se descifra con la clave maestra, que es con
   * la que se escribió. Un payload v2 **solo** se descifra con la clave de SU ámbito: pedirlo
   * desde otro falla, y falla en el descifrado, no en una comprobación que alguien pudiera
   * olvidar.
   */
  decryptFor(scope: EncryptionScope, payload: string): string {
    const partes = payload.split(':');

    if (partes[0] === V2) {
      const [, ivB64, authTagB64, ciphertextB64] = partes;
      return this.open(this.keyFor(scope), ivB64, authTagB64, ciphertextB64);
    }

    return this.decrypt(payload);
  }

  /** ¿Está en el formato antiguo? Sirve para decidir si conviene reescribirlo. */
  isLegacyFormat(payload: string): boolean {
    return !payload.startsWith(`${V2}:`);
  }

  private keyFor(scope: EncryptionScope): Buffer {
    const label = scopeLabel(scope);
    const memo = this.derived.get(label);
    if (memo) return memo;

    /*
     * HKDF-SHA256 sobre la clave maestra. Sin sal: el material de entrada ya es una clave
     * uniforme de 32 bytes, y la etiqueta del ámbito —que entra como `info`— es lo que
     * separa una derivación de otra.
     */
    const key = Buffer.from(
      hkdfSync('sha256', this.key, Buffer.alloc(0), label, 32),
    );
    this.derived.set(label, key);
    return key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const partes = payload.split(':');
    // Un payload v2 leído por la vía sin ámbito sería un error de programación silencioso:
    // se descifraría mal o no se descifraría, y el mensaje no diría por qué.
    if (partes[0] === V2) {
      throw new Error(
        'Este secreto está cifrado para un ámbito concreto: usa decryptFor(scope, payload)',
      );
    }
    const [ivB64, authTagB64, ciphertextB64] = partes;
    return this.open(this.key, ivB64, authTagB64, ciphertextB64);
  }

  private open(
    key: Buffer,
    ivB64?: string,
    authTagB64?: string,
    ciphertextB64?: string,
  ): string {
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Payload cifrado con formato inválido');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
