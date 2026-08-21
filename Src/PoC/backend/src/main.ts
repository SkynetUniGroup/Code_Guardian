import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MongoSerializeInterceptor } from './common/interceptors/mongo-serialize.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({ origin: '*' });
  
  // Applica il prefisso globale escludendo esplicitamente le rotte interne
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'internal/(.*)', method: RequestMethod.ALL }],
  });
  
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new MongoSerializeInterceptor());

  // Configurazione Swagger 
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