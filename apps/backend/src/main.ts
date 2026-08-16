import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);

  app.enableCors({
    origin: configService.get('frontendUrl', { infer: true }) ?? true,
    credentials: true,
  });
  // El token de refresco viaja en una cookie `HttpOnly` desde que se cerró la deuda de
  // seguridad: sin esto, `req.cookies` no existe y no habría forma de leerla.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformResponseInterceptor());

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  Logger.log(
    `BusinessBrain API escuchando en http://localhost:${port}`,
    'Bootstrap',
  );
}
void bootstrap();
