import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);

  // La misma función que usa el arranque de los tests. Si aquí se añadiera algo que allí no
  // está, la suite dejaría de probar la aplicación que se despliega.
  configureApp(app, {
    isProduction: configService.get('nodeEnv', { infer: true }) === 'production',
    frontendUrl: configService.get('frontendUrl', { infer: true }),
  });

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  Logger.log(
    `BusinessBrain API escuchando en http://localhost:${port}`,
    'Bootstrap',
  );
}
void bootstrap();
