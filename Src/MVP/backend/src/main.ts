import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody: true exposes request.rawBody (the exact bytes received) instead
  // of only the parsed object. InternalAuthGuard hashes those exact bytes to
  // verify the HMAC signature on /internal/* requests — re-serializing the
  // already-parsed body could produce different bytes (key order, spacing)
  // than what the caller actually signed, breaking a valid signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    //what actually runs the class-validator decorators on DTOs
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN'),
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Code Guardian — Backend MVP')
    .setDescription('API del backend di Code Guardian')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
void bootstrap();
