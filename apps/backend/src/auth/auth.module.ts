import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './application/password-reset.service';
import { MfaService } from './application/mfa.service';
import { MfaAdministrationService } from './application/mfa-administration.service';
import { ReauthenticationService } from './application/reauthentication.service';
import { MfaController, OrganizationMfaController } from './api/mfa.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { EncryptionService } from '../common/utils/encryption.util';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, MfaController, OrganizationMfaController],
  providers: [
    AuthService,
    PasswordResetService,
    // El mismo cifrado que protege las claves de los proveedores de IA. El secreto TOTP tiene
    // que poder descifrarse para verificar un código, así que un hash no vale aquí.
    EncryptionService,
    MfaService,
    MfaAdministrationService,
    ReauthenticationService,
    JwtStrategy,
    LocalStrategy,
  ],
  exports: [AuthService, MfaService, MfaAdministrationService],
})
export class AuthModule {}
