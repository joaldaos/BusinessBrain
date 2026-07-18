import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { AppConfig } from '../../config/configuration';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recomendado para GCM

/**
 * Cifra secretos en reposo (KnowledgeSource.configEnc, LlmProfile.apiKeyEnc,
 * Integration.accessTokenEnc/refreshTokenEnc). El resultado es un string
 * autocontenido "iv:authTag:ciphertext" en base64, para no necesitar columnas
 * adicionales en el schema.
 *
 * La clave (ENCRYPTION_KEY) se valida en env.validation.ts como base64 de 32 bytes.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

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
    const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Payload cifrado con formato inválido');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
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
