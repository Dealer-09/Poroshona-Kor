import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable global validation using class-validator and class-transformer
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Enable CORS since the Chrome Extension/Web App will be consuming this API
  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
