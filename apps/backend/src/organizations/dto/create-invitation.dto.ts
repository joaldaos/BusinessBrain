import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { MembershipRole } from '@businessbrain/database';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(MembershipRole)
  role?: MembershipRole;
}
