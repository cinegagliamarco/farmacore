export function catchUnhandledSignals(): void {
  process.on('uncaughtException', (err: Error) => {
    const message = `Received uncaughtException ${err.message}`;
    console.error(message, 'GlobalExceptionSignalsHandler');
  });
  process.on('unhandledRejection', (err: Error) => {
    const message = `Received unhandledRejection ${err.message}`;
    console.error(message, 'GlobalExceptionSignalsHandler');
  });
}
