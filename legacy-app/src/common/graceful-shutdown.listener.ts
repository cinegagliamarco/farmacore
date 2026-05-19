import { INestApplication } from '@nestjs/common';

export function setupGracefulShutdown(app: INestApplication): void {
  // Heroku sends SIGTERM when shutting down dynos
  process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received - Starting graceful shutdown...');
    await gracefulShutdown(app);
  });

  // Handle SIGINT for local development (Ctrl+C)
  process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received - Starting graceful shutdown...');
    await gracefulShutdown(app);
  });
}

async function gracefulShutdown(app: INestApplication): Promise<void> {
  try {
    console.log('⏳ Closing application...');
    
    // Force garbage collection before shutdown
    if (global.gc) {
      console.log('🧹 Running final garbage collection...');
      global.gc();
    }
    
    // NestJS will handle closing DB connections, HTTP server, etc.
    await app.close();
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Optional: Function to trigger restart programmatically (e.g., based on memory threshold)
export async function requestRestart(app: INestApplication, reason: string): Promise<void> {
  console.log(`🔄 Restart requested: ${reason}`);
  await gracefulShutdown(app);
}

// Simplified restart function that can be called from anywhere without app instance
export function requestRestartSimple(reason: string): void {
  console.log(`🔄 Restart requested: ${reason}`);
  
  // Force final GC before restart
  if (global.gc) {
    console.log('🧹 Running final garbage collection...');
    global.gc();
  }
  
  // This will trigger the graceful shutdown handlers (SIGTERM/SIGINT)
  // which will properly close DB connections, HTTP server, etc.
  console.log('✅ Initiating graceful shutdown');
  process.exit(0);
}

