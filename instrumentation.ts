// Next.js 14 instrumentation hook. Runs once at server boot (in Node runtime).
// We use it to install process-level safety nets so a stray unhandled
// rejection in a route handler or a library throws (like the pdf-lib
// WinAnsi encoder) logs the cause instead of silently killing the process.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  process.on('unhandledRejection', (reason) => {
    // Log loudly but don't exit. Some routes have already responded to the
    // client; let the process keep serving.
    console.error('[unhandledRejection]', reason);
  });

  process.on('uncaughtException', (err) => {
    // Truly fatal, but at least we get the cause in the log before exiting.
    console.error('[uncaughtException]', err);
  });
}
