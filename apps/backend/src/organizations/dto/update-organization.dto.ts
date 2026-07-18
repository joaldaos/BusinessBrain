import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
