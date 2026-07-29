import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MongoSerializeInterceptor } from './common/interceptors/mongo-serialize.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({ origin: '*' });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new MongoSerializeInterceptor());

  // 2. Configurazione Swagger 
  const config = new DocumentBuilder()
    .setTitle('Code Guardian API')
    .setDescription('API pubbliche per il PoC degli Agenti SkyNet')
    .setVersion('1.0')
    .addBearerAuth() // Aggiunge il supporto per il token JWT
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3000);
}
bootstrap();