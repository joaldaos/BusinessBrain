import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import type { RequestUser } from '../common/types/authenticated-request';
import type { User } from '@businessbrain/database';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Body() _dto: LoginDto, @Request() req: { user: User }) {
    const tokens = await this.authService.issueTokens(req.user);
    return { ...tokens, user: this.authService.toPublicUser(req.user) };
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
