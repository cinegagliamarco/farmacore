import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { requestRestart, setupGracefulShutdown } from './common/graceful-shutdown.listener';
import { catchUnhandledSignals } from './common/unhandled-signals.listener';
import { TypeOrmDataSource } from './database/typeorm.data-source';

async function bootstrap() {
  // Enable garbage collection for memory optimization
  if (process.env.NODE_ENV === 'production') {
    // Force garbage collection to be available
    if (global.gc) {
      console.log('✅ Garbage collection enabled');
    } else {
      console.log('⚠️ Garbage collection not available. Consider running with --expose-gc flag');
    }
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*', allowedHeaders: '*' });

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );

  // Add memory monitoring in production
  if (process.env.NODE_ENV === 'production') {
    const herokuMemoryLimit = 512; // MB total RAM for Standard-1X dyno
    const criticalMemoryThreshold = parseInt(process.env.CRITICAL_MEMORY_THRESHOLD || '450', 10); // 450MB default (88% of total RAM)

    setInterval(async () => {
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024), // Resident Set Size - memory used by the process
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // Total heap size
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // Heap used by the process
        external: Math.round(memUsage.external / 1024 / 1024) // Memory used by the process for non-heap allocations
      };

      const memoryPercentage = Math.round((memUsageMB.rss / herokuMemoryLimit) * 100);
      const availableMemory = herokuMemoryLimit - memUsageMB.rss;

      let memoryStatus = '🟢 Healthy';
      if (memoryPercentage > 80) memoryStatus = '🔴 High';
      else if (memoryPercentage > 60) memoryStatus = '🟡 Moderate';

      console.log(
        `📊 Memory: ${memUsageMB.rss}MB/${herokuMemoryLimit}MB (${memoryPercentage}%) ${memoryStatus} | Available: ${availableMemory}MB | Heap: ${memUsageMB.heapUsed}MB`
      );

      // Check for critical memory threshold - trigger restart if exceeded
      if (memUsageMB.rss > criticalMemoryThreshold) {
        console.log(`🚨 CRITICAL: Memory usage (${memUsageMB.rss}MB) exceeded threshold (${criticalMemoryThreshold}MB)`);
        await requestRestart(app, `Memory usage: ${memUsageMB.rss}MB > ${criticalMemoryThreshold}MB`);
        return; // Exit after requesting restart
      }

      // More aggressive GC when memory is high
      if (global.gc) {
        if (memUsageMB.rss > 320) {
          // 320MB threshold (62% of total RAM, 80% of max-old-space)
          console.log('🧹 Forcing garbage collection due to high memory usage');
          global.gc();

          // Run GC multiple times if memory is critically high
          if (memUsageMB.rss > 380) {
            // 380MB (74% of total RAM, 95% of max-old-space)
            setTimeout(() => {
              if (global.gc) {
                global.gc();
                console.log('🧹 Running additional GC cycle');
              }
            }, 1000);
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }

  app.enableShutdownHooks();

  // Setup graceful shutdown handlers for SIGTERM and SIGINT
  setupGracefulShutdown(app);

  await TypeOrmDataSource.runMigrations();

  catchUnhandledSignals();

  await app.listen(process.env.PORT || 3000);
}

bootstrap();
